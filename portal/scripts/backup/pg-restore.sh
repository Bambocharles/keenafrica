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
# Optional:
#   PG_IMAGE              Default: postgres:16-alpine (match the dump's server version)
set -euo pipefail

: "${RESTORE_CONFIRM:?Set RESTORE_CONFIRM=yes to confirm you intend to overwrite the target database}"
if [ "$RESTORE_CONFIRM" != "yes" ]; then
  echo "RESTORE_CONFIRM must be exactly 'yes'." >&2
  exit 1
fi

dump_file="${1:?Usage: pg-restore.sh <dump-file> <target-database-url>}"
target_url="${2:?Usage: pg-restore.sh <dump-file> <target-database-url>}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

if [ ! -f "$dump_file" ]; then
  echo "Dump file not found: $dump_file" >&2
  exit 1
fi
dump_dir="$(cd "$(dirname "$dump_file")" && pwd)"
dump_base="$(basename "$dump_file")"

echo "==> Restoring $dump_file into target (schema is dropped/recreated via --clean --if-exists)"
docker run --rm \
  --network host \
  -v "$dump_dir":/backup \
  -e PGRESTORE_URL="$target_url" \
  "$PG_IMAGE" \
  bash -c 'pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$PGRESTORE_URL" "/backup/'"$dump_base"'"'

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

echo "==> Restore command completed. Run your own row-count/spot-check queries against the target before trusting it."
