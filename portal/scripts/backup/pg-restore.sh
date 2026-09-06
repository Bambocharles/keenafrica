#!/usr/bin/env bash
# Restores a pg_dump custom-format archive into a target database.
# Deliberately requires an explicit confirmation env var — this command
# overwrites the target database's tables. See docs/BACKUP_RESTORE.md.
#
# Usage:
#   RESTORE_CONFIRM=yes ./pg-restore.sh /path/to/portal-<ts>.dump "$DATABASE_URL"
#
# Required:
#   RESTORE_CONFIRM=yes   Refuses to run without this, on purpose.
#   $1                    Path to the .dump file to restore.
#   $2                    Target DATABASE_URL. Must be a role that owns the
#                          tables (the migrator role) — pg_restore needs to
#                          create/drop objects, which RLS's app role cannot do.
#                          The grant step below also re-issues ALTER DEFAULT
#                          PRIVILEGES *for this role*, so it must be the same
#                          role that owns the schema in production.
# Optional:
#   EXPECTED_PG_MAJOR     Production's Postgres major version. Default: 14.
#                          Both the client image and the target server are
#                          checked against it and the script refuses to run on
#                          a mismatch (Session 49; see §11.2(c) of
#                          docs/GO_LIVE_READINESS.md).
#   PG_IMAGE              Client image. Default: postgres:$EXPECTED_PG_MAJOR-alpine
#   RESTORE_APP_ROLE      Runtime app role to re-grant to after the restore.
#                          Default: kf_portal_prod_app. Set to "none" to skip
#                          (only appropriate when the target already carries
#                          the grants, e.g. an in-place production restore).
#   ALLOW_PG_MAJOR_MISMATCH=yes   Proceed despite a version mismatch. Escape
#                          hatch for a deliberate cross-version restore; you
#                          own the consequences.
#   PG_FALLBACK_READER_IMAGES     Images tried, in order, when the archive is
#                          too new for $PG_IMAGE's pg_restore to read.
#   RESTORE_IGNORABLE_ERROR_REGEX Which pg_restore errors are treated as
#                          ignorable. Default: "must be owner of extension".
#                          Anything else makes the script exit non-zero (after
#                          still running the post-restore steps).
set -euo pipefail

: "${RESTORE_CONFIRM:?Set RESTORE_CONFIRM=yes to confirm you intend to overwrite the target database}"
if [ "$RESTORE_CONFIRM" != "yes" ]; then
  echo "RESTORE_CONFIRM must be exactly 'yes'." >&2
  exit 1
fi

dump_file="${1:?Usage: pg-restore.sh <dump-file> <target-database-url>}"
target_url="${2:?Usage: pg-restore.sh <dump-file> <target-database-url>}"

EXPECTED_PG_MAJOR="${EXPECTED_PG_MAJOR:-14}"
PG_IMAGE="${PG_IMAGE:-postgres:${EXPECTED_PG_MAJOR}-alpine}"
RESTORE_APP_ROLE="${RESTORE_APP_ROLE:-kf_portal_prod_app}"
ALLOW_PG_MAJOR_MISMATCH="${ALLOW_PG_MAJOR_MISMATCH:-no}"
PG_FALLBACK_READER_IMAGES="${PG_FALLBACK_READER_IMAGES:-postgres:15-alpine postgres:16-alpine postgres:17-alpine}"
RESTORE_IGNORABLE_ERROR_REGEX="${RESTORE_IGNORABLE_ERROR_REGEX:-must be owner of extension}"

if [ ! -f "$dump_file" ]; then
  echo "Dump file not found: $dump_file" >&2
  exit 1
fi
dump_dir="$(cd "$(dirname "$dump_file")" && pwd)"
dump_base="$(basename "$dump_file")"

work_dir="$(mktemp -d)"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

# --- Version reconciliation (Session 49, §11.2(c)) ---------------------
# Production runs PostgreSQL 14.24. Both scripts used to default to
# postgres:16-alpine, directly against PG_IMAGE's own documented contract
# ("keep this in sync with the server's major version"), which meant every
# dump was written in an archive format PostgreSQL 14's own pg_restore
# cannot read at all ("unsupported version (1.15) in file header"). Anyone
# recovering with tooling matched to the production server — the psql on
# postgres01, or a rebuilt PG 14 host — was stopped dead by a one-line
# error, during an incident. The default is now pinned to production's
# major version and every mismatch is checked for and refused rather than
# discovered mid-incident.
client_version="$(docker run --rm "$PG_IMAGE" pg_restore --version | awk '{print $NF}')"
client_major="${client_version%%.*}"

fail_version() {
  echo "!! VERSION MISMATCH: $1" >&2
  echo "!! EXPECTED_PG_MAJOR says production runs PostgreSQL ${EXPECTED_PG_MAJOR}.x. Restoring with" >&2
  echo "!! mismatched tooling is how a disaster-recovery restore fails at the worst" >&2
  echo "!! possible time." >&2
  echo "!! Fix the mismatch, or set ALLOW_PG_MAJOR_MISMATCH=yes to proceed deliberately." >&2
  exit 1
}

if [ "$client_major" != "$EXPECTED_PG_MAJOR" ] && [ "$ALLOW_PG_MAJOR_MISMATCH" != "yes" ]; then
  fail_version "PG_IMAGE=$PG_IMAGE provides pg_restore $client_version, but EXPECTED_PG_MAJOR=$EXPECTED_PG_MAJOR."
fi

echo "==> Checking the target server's version"
if ! server_version_num="$(docker run --rm --network host -e PGRESTORE_URL="$target_url" "$PG_IMAGE" \
      bash -c 'psql -X --quiet --no-psqlrc -tA -d "$PGRESTORE_URL" -c "SHOW server_version_num"' 2>&1)" \
   || ! [[ "$server_version_num" =~ ^[0-9]+$ ]]; then
  echo "!! Could not connect to the target database to check its version:" >&2
  echo "$server_version_num" | sed 's/^/!!   /' >&2
  exit 1
fi
server_major="$(( server_version_num / 10000 ))"
if [ "$server_major" != "$EXPECTED_PG_MAJOR" ] && [ "$ALLOW_PG_MAJOR_MISMATCH" != "yes" ]; then
  fail_version "the target server is PostgreSQL $server_major (server_version_num=$server_version_num), but EXPECTED_PG_MAJOR=$EXPECTED_PG_MAJOR."
fi
echo "    target server major: $server_major, client: $client_version, expected: $EXPECTED_PG_MAJOR"

# Archives written before the pin above (by pg_dump 16) are in a format the
# pinned pg_restore cannot read. Those dumps are real backups and stay on
# disk for months under the retention policy, so refusing them outright
# would mean "we pinned the version and lost the ability to restore last
# month's backup". Detect it empirically — try to list the archive, and only
# if that fails for a version reason, escalate to a reader new enough to
# read it. The restored *data* is still PostgreSQL 14 data either way; only
# the archive container format is newer.
reader_image="$PG_IMAGE"
if ! docker run --rm -v "$dump_dir":/backup "$PG_IMAGE" \
      pg_restore --list "/backup/$dump_base" >/dev/null 2>"$work_dir/list.err"; then
  if grep -q "unsupported version" "$work_dir/list.err"; then
    archive_version="$(sed -n 's/.*unsupported version (\([0-9.]*\)).*/\1/p' "$work_dir/list.err" | head -1)"
    reader_image=""
    for candidate in $PG_FALLBACK_READER_IMAGES; do
      if docker run --rm -v "$dump_dir":/backup "$candidate" \
           pg_restore --list "/backup/$dump_base" >/dev/null 2>"$work_dir/list-$RANDOM.err"; then
        reader_image="$candidate"
        break
      fi
    done
    if [ -z "$reader_image" ]; then
      echo "!! $dump_base reports archive format $archive_version and could not be read by" >&2
      echo "!! $PG_IMAGE or by any image in PG_FALLBACK_READER_IMAGES" >&2
      echo "!! ($PG_FALLBACK_READER_IMAGES). Either it is a format newer than all of them," >&2
      echo "!! or the file is truncated/corrupt. Errors from the last attempt:" >&2
      cat "$work_dir"/list-*.err 2>/dev/null | tail -5 | sed 's/^/!!   /' >&2
      exit 1
    fi
    echo "!! ------------------------------------------------------------------"
    echo "!! LEGACY ARCHIVE: $dump_base is archive format $archive_version, written by a"
    echo "!! pg_dump newer than production's PostgreSQL $EXPECTED_PG_MAJOR (i.e. taken before this"
    echo "!! script was pinned). PostgreSQL $EXPECTED_PG_MAJOR's own pg_restore CANNOT read it."
    echo "!! Reading it with $reader_image instead; the target server is still"
    echo "!! PostgreSQL $server_major, so the restored database is unaffected."
    echo "!! Dumps taken from now on are readable by PostgreSQL $EXPECTED_PG_MAJOR tooling directly."
    echo "!! ------------------------------------------------------------------"
  else
    echo "!! $dump_base is not a readable pg_dump archive:" >&2
    cat "$work_dir/list.err" >&2
    exit 1
  fi
fi

echo "==> Restoring $dump_file into target (schema is dropped/recreated via --clean --if-exists)"
restore_log="$work_dir/pg_restore.log"
set +e
docker run --rm \
  --network host \
  -v "$dump_dir":/backup \
  -e PGRESTORE_URL="$target_url" \
  "$reader_image" \
  bash -c 'pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$PGRESTORE_URL" "/backup/'"$dump_base"'"' 2>&1 | tee "$restore_log"
restore_status="${PIPESTATUS[0]}"
set -e

# pg_restore exits non-zero on IGNORABLE errors too (Session 49, §11.2(b)).
# Restoring into a database whose extensions were created by another role —
# exactly what the runbook's "create the database, then CREATE EXTENSION"
# step produces — makes the archive's DROP EXTENSION/COMMENT ON EXTENSION
# entries fail harmlessly, and pg_restore then exits 1 with
# "warning: errors ignored on restore: N". Under `set -e` that used to kill
# the script here, before the ANALYZE and jit=off steps below — the two
# steps that exist precisely because a dump doesn't carry them, skipped in
# exactly the scenario they were written for. So: capture the status,
# classify the errors it reported (see below), and continue to those steps
# whenever they are the known-benign ones.
restore_unclassified_errors=0
if [ "$restore_status" -ne 0 ]; then
  if grep -Eq 'errors ignored on restore: [0-9]+' "$restore_log"; then
    ignored="$(grep -Eo 'errors ignored on restore: [0-9]+' "$restore_log" | grep -Eo '[0-9]+$' | tail -1)"
    # "It printed a summary" is NOT on its own enough to call an exit
    # ignorable: pg_restore prints that same summary for real failures, since
    # it continues past errors unless --exit-on-error is given. So classify
    # them. Only errors matching RESTORE_IGNORABLE_ERROR_REGEX are treated as
    # benign; anything else is reported as a genuine failure.
    unclassified="$(grep -E '^pg_restore: error:' "$restore_log" \
                    | grep -Ev "$RESTORE_IGNORABLE_ERROR_REGEX" || true)"
    if [ -z "$unclassified" ]; then
      echo "==> pg_restore exited $restore_status with $ignored ignorable error(s), all matching"
      echo "    the expected extension-ownership pattern (/$RESTORE_IGNORABLE_ERROR_REGEX/)."
      echo "    These occur whenever the extensions were created by a different role than the"
      echo "    one restoring — i.e. every time the restore runbook's step 2 is followed."
      echo "    Continuing to the post-restore steps."
    else
      restore_unclassified_errors=1
      echo "!! ------------------------------------------------------------------" >&2
      echo "!! pg_restore exited $restore_status reporting $ignored ignored error(s), and some" >&2
      echo "!! of them are NOT the known-benign extension-ownership failures:" >&2
      unclassified_count="$(printf '%s\n' "$unclassified" | wc -l)"
      printf '%s\n' "$unclassified" | head -10 | sed 's/^/!!   /' >&2
      if [ "$unclassified_count" -gt 10 ]; then
        echo "!!   ... and $(( unclassified_count - 10 )) more (full output above)." >&2
      fi
      echo "!! Continuing through the post-restore steps anyway (they are cheap, and" >&2
      echo "!! skipping them is the exact defect Session 49 fixed) — but this script" >&2
      echo "!! will exit non-zero at the end. DO NOT trust this database until you" >&2
      echo "!! have read those errors." >&2
      echo "!! ------------------------------------------------------------------" >&2
    fi
  else
    echo "!! pg_restore failed with exit status $restore_status and reported no ignored-error" >&2
    echo "!! summary at all — it did not get far enough to restore anything. The target" >&2
    echo "!! database is NOT usable." >&2
    exit "$restore_status"
  fi
fi

# --- Re-apply the runtime role's privileges (Session 49, §11.2(a)) -----
# pg-backup.sh dumps with --no-privileges and the restore above runs with
# --no-owner --no-privileges, so NO grant is carried in a dump. The grants
# production actually runs on are created once, out of band, by
# ~/portal-db-setup-prod.sh — and ALTER DEFAULT PRIVILEGES is per-database
# catalog state (pg_default_acl), which is not in a dump either, for the
# same reason statistics and jit=off are not. Restoring into a FRESH
# database therefore used to produce a database with all the data in it and
# zero privileges for the app role: `permission denied for table users` on
# the very first query the portal makes. Measured on 2026-09-06 against a
# real production dump: 0 rows in role_table_grants for kf_portal_prod_app.
# This step reconstructs exactly what portal-db-setup-prod.sh grants — no
# more (it is deliberately not a general-purpose ACL restore) — and fails
# loudly if the role doesn't exist, because on genuinely fresh
# infrastructure the roles must be created before the data is usable.
if [ "$RESTORE_APP_ROLE" = "none" ]; then
  echo "==> Skipping app-role grants (RESTORE_APP_ROLE=none)"
else
  echo "==> Re-applying $RESTORE_APP_ROLE's grants (privileges are not carried in a dump)"
  cat > "$work_dir/grants.sql" <<'SQL_EOF'
\set ON_ERROR_STOP on
SELECT set_config('kf.app_role', :'app_role', false);
DO $$
DECLARE
  app_role text := current_setting('kf.app_role');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION
      'Role "%" does not exist on this server. Roles are cluster-level and are NOT carried in a pg_dump: create them first (see ~/portal-db-setup-prod.sh and step 2 of the restore runbook in docs/BACKUP_RESTORE.md), then re-run this restore. Without them the restored database has all its data and no way for the application to read it.',
      app_role;
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    current_user, app_role);
END $$;
-- GRANT USAGE ON SCHEMA public above is a no-op ("WARNING: no privileges were
-- granted") when the restoring role does not own schema public — normal on a
-- fresh database, where schema public is owned by the bootstrap superuser and
-- PUBLIC already holds USAGE by default. That default is what production
-- actually relies on, so verify the effective privilege rather than the grant.
DO $$
BEGIN
  IF NOT has_schema_privilege(current_setting('kf.app_role'), 'public', 'USAGE') THEN
    RAISE EXCEPTION
      'Role "%" has no USAGE on schema public and this role cannot grant it (schema public is owned by another role). Run "GRANT USAGE ON SCHEMA public TO %;" as a superuser or as the schema owner, then re-run this restore.',
      current_setting('kf.app_role'), current_setting('kf.app_role');
  END IF;
END $$;

SELECT count(*) AS grants_for_app_role
  FROM information_schema.role_table_grants
 WHERE grantee = current_setting('kf.app_role');
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE grantee = current_setting('kf.app_role');
  IF n = 0 THEN
    RAISE EXCEPTION 'No table grants exist for "%" after the grant step — the restored database is unusable by the application.',
      current_setting('kf.app_role');
  END IF;
END $$;
SQL_EOF
  docker run --rm \
    --network host \
    -v "$work_dir":/sql:ro \
    -e PGRESTORE_URL="$target_url" \
    -e APP_ROLE="$RESTORE_APP_ROLE" \
    "$PG_IMAGE" \
    bash -c 'psql --quiet --no-psqlrc -v ON_ERROR_STOP=1 -v app_role="$APP_ROLE" -d "$PGRESTORE_URL" -f /sql/grants.sql'
fi

# ANALYZE after every restore (Session 45). pg_restore does NOT compute
# statistics — every restored table comes up with reltuples = -1, i.e. "never
# analyzed", and Postgres then plans against default row estimates. That is
# not cosmetic here: this schema's RLS policies nest EXISTS subqueries 3-4
# tables deep, so a default estimate multiplies out into a plan whose
# ESTIMATED cost crosses Postgres's jit_above_cost threshold and triggers
# multi-second JIT compilation for a query that returns almost nothing. It is
# the same mechanism behind the Session 31 production P0; measured on live
# production on 2026-09-06, an unfiltered `SELECT id FROM assets` (6 rows)
# took 15,399 ms and JIT-compiled 4,796 functions before ANALYZE, and 10.9 ms
# after it. A restore without this step therefore hands you a database that
# behaves pathologically until something happens to analyze it — and at these
# row counts autoanalyze never fires on its own (its threshold is 50 changed
# rows). Cheap: the full-database ANALYZE on production took 996 ms.
echo "==> Running ANALYZE on the restored database (statistics are not included in a dump)"
docker run --rm   --network host   -e PGRESTORE_URL="$target_url"   "$PG_IMAGE"   bash -c 'psql --quiet --no-psqlrc -v ON_ERROR_STOP=1 -d "$PGRESTORE_URL" -c "ANALYZE;"'   || echo "WARNING: ANALYZE failed. The restore itself succeeded, but query plans on this database will be poor until you run 'ANALYZE;' against it yourself." >&2

# Re-apply the database-level jit=off setting (Session 46). Like statistics,
# a database's own GUC defaults (pg_db_role_setting) are NOT carried in a
# dump — they are a property of the database object, not its contents. The
# 20260906120000_disable_jit_deep_rls_policies migration sets jit=off because
# this schema's deep RLS policies otherwise cross Postgres's jit_above_cost
# and JIT-compile thousands of functions for trivial queries (Session 31's P0
# mechanism). A disaster-recovery restore into a freshly created database
# would come up WITHOUT that setting and reproduce the pathology until the
# next `prisma migrate deploy` re-ran the migration — so set it here too, the
# same defense-in-depth reasoning as the ANALYZE step above.
echo "==> Setting jit=off on the restored database (a database-level setting is not carried in a dump)"
docker run --rm   --network host   -e PGRESTORE_URL="$target_url"   "$PG_IMAGE"   bash -c 'psql --quiet --no-psqlrc -v ON_ERROR_STOP=1 -d "$PGRESTORE_URL" -c "DO \$\$ BEGIN EXECUTE format('"'"'ALTER DATABASE %I SET jit = off'"'"', current_database()); END \$\$;"'   || echo "WARNING: setting jit=off failed. The restore itself succeeded, but deep RLS-policy queries may JIT-compile pathologically until you run it yourself." >&2

if [ "$restore_unclassified_errors" -ne 0 ]; then
  echo "!! Restore FINISHED WITH UNCLASSIFIED pg_restore ERRORS — see above. The" >&2
  echo "!! post-restore steps (grants, ANALYZE, jit=off) did run, but this restore" >&2
  echo "!! is not trustworthy until those errors are understood." >&2
  exit 1
fi

echo "==> Restore command completed. Run your own row-count/spot-check queries against the target before trusting it."
