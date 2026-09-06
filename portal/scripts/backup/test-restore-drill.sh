#!/usr/bin/env bash
# Restore drill: proves a real dump actually restores into a clean database
# with matching data, intact RLS, AND privileges the application can
# actually use — using only disposable Docker containers. Safe to run
# anywhere Docker is available — never touches a real/shared database.
#
# Run this:
#  - after any change to the schema, migration, or backup/restore scripts
#  - periodically (e.g. quarterly) against a real prod dump, as a genuine
#    DR exercise — see docs/BACKUP_RESTORE.md
#
# What it does:
#   1. Starts an ephemeral source Postgres (production's major version),
#      applies all migrations.
#   2. Inserts a marker row.
#   3. Runs pg-backup.sh against it.
#   4. Starts a second, empty ephemeral Postgres ("the disaster") and
#      prepares it the way the restore runbook says to: cluster roles, a
#      database owned by the migrator role, and the two extensions.
#   5. Runs pg-restore.sh into it as the migrator role.
#   6. Asserts the marker row, the RLS policies, the app role's privileges,
#      the statistics and the jit setting all survived, then tears both down.
#
# Step 6's app-role assertion is the one that matters most and the one this
# drill did NOT make until Session 49: it previously restored as the
# Postgres superuser, which bypasses privileges entirely, so it passed
# happily for months against a restore procedure that produced a database
# the portal could not read a single row from (docs/GO_LIVE_READINESS.md
# §11.2(a)). A drill that does not use the role the application uses is
# not a drill.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # -> portal/

# Production's major version. Keep in sync with pg-backup.sh/pg-restore.sh.
EXPECTED_PG_MAJOR="${EXPECTED_PG_MAJOR:-14}"
DRILL_PG_IMAGE="postgres:${EXPECTED_PG_MAJOR}-alpine"

SRC_CONTAINER="portal-drill-src-$$"
DST_CONTAINER="portal-drill-dst-$$"
DRILL_DIR="$(mktemp -d)"
SRC_PORT=55501
DST_PORT=55502

# Production's role names, so the drill exercises pg-restore.sh's real
# defaults rather than a drill-only special case.
MIGRATOR_ROLE=kf_portal_prod_migrator
APP_ROLE=kf_portal_prod_app
DRILL_PW=drill

cleanup() {
  docker rm -f "$SRC_CONTAINER" "$DST_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

# Wait for the REAL server, not the postgres image's temporary init server.
# The entrypoint starts a throwaway server on a unix socket only, to run
# initdb scripts; `docker exec pg_isready` answers "yes" during that phase,
# so anything that trusts it can land before the database exists or while
# the temp server is shutting down. That race is exactly what failed three
# scheduled backup verifications (docs/GO_LIVE_READINESS.md §11.3). A
# successful query over the mapped TCP port cannot be answered by the init
# server, so it is race-free by construction.
wait_for_server() {
  local port="$1" name="$2"
  for _ in $(seq 1 60); do
    if docker run --rm --network host \
         -e U="postgresql://postgres:${DRILL_PW}@127.0.0.1:${port}/postgres" \
         "$DRILL_PG_IMAGE" bash -c 'psql -X -q -tA -d "$U" -c "select 1"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "!! $name never became ready on port $port" >&2
  exit 1
}

echo "==> Starting ephemeral source DB ($SRC_CONTAINER, $DRILL_PG_IMAGE)"
docker run -d --name "$SRC_CONTAINER" \
  -e POSTGRES_PASSWORD="$DRILL_PW" -e POSTGRES_DB=drill_src \
  -p "$SRC_PORT":5432 "$DRILL_PG_IMAGE" >/dev/null
wait_for_server "$SRC_PORT" "$SRC_CONTAINER"

SRC_URL="postgresql://postgres:${DRILL_PW}@localhost:${SRC_PORT}/drill_src"
echo "==> Applying migrations to source"
DATABASE_URL="$SRC_URL" npx prisma migrate deploy >/dev/null

MARKER="drill-marker-$(date -u +%s)"
echo "==> Inserting marker sponsor: $MARKER"
docker exec "$SRC_CONTAINER" psql -U postgres -d drill_src -c \
  "INSERT INTO sponsors (name) VALUES ('$MARKER');" >/dev/null

echo "==> Running pg-backup.sh"
DATABASE_URL="$SRC_URL" BACKUP_DIR="$DRILL_DIR" ./scripts/backup/pg-backup.sh

dump_file="$(ls -t "$DRILL_DIR"/*.dump | head -1)"

echo "==> Starting ephemeral destination DB ($DST_CONTAINER) — simulates 'new infra after data loss'"
docker run -d --name "$DST_CONTAINER" \
  -e POSTGRES_PASSWORD="$DRILL_PW" \
  -p "$DST_PORT":5432 "$DRILL_PG_IMAGE" >/dev/null
wait_for_server "$DST_PORT" "$DST_CONTAINER"

# The restore runbook's preparation step, verbatim: the cluster roles (which
# a pg_dump never carries), a database owned by the migrator, and the two
# extensions. Creating the extensions as the superuser is what makes
# pg_restore's DROP/COMMENT ON EXTENSION entries fail harmlessly and exit
# non-zero — i.e. this drill deliberately reproduces the ignorable-error
# condition that used to abort pg-restore.sh before its own last two steps.
echo "==> Preparing the destination the way the restore runbook says to"
docker exec -i "$DST_CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE $MIGRATOR_ROLE LOGIN PASSWORD '$DRILL_PW' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE $APP_ROLE LOGIN PASSWORD '$DRILL_PW' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE DATABASE drill_dst OWNER $MIGRATOR_ROLE;
SQL
docker exec "$DST_CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 -d drill_dst -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;" >/dev/null

DST_URL="postgresql://${MIGRATOR_ROLE}:${DRILL_PW}@localhost:${DST_PORT}/drill_dst"
APP_URL="postgresql://${APP_ROLE}:${DRILL_PW}@127.0.0.1:${DST_PORT}/drill_dst"

echo "==> Running pg-restore.sh (as the migrator role, not the superuser)"
RESTORE_CONFIRM=yes ./scripts/backup/pg-restore.sh "$dump_file" "$DST_URL"

fail() { echo "!! DRILL FAILED: $1" >&2; exit 1; }

echo "==> Verifying marker row survived the round trip"
found="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM sponsors WHERE name = '$MARKER';")"
[ "$found" = "1" ] || fail "marker row not found after restore (count=$found)"

echo "==> Verifying RLS survived the round trip"
policy_count="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM pg_policies;")"
[ "$policy_count" -ge 1 ] || fail "no RLS policies present after restore"

# The assertion this drill exists for (Session 49). Privileges are not
# carried in a dump; without pg-restore.sh's grant step this query is
# "ERROR: permission denied for table users" and the restored database is
# useless to the application.
echo "==> Verifying the RLS-scoped app role can actually READ a table"
if ! app_read="$(docker run --rm --network host -e U="$APP_URL" "$DRILL_PG_IMAGE" \
      bash -c 'psql -X -q -tA -d "$U" -c "select count(*) from users"' 2>&1)"; then
  fail "the $APP_ROLE role cannot read a restored table: $app_read"
fi
echo "    $APP_ROLE read users successfully (count=$app_read; 0 is correct under RLS with no session context)"

grant_count="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = '$APP_ROLE';")"
[ "$grant_count" -ge 1 ] || fail "no table grants for $APP_ROLE after restore"

# Both post-restore steps must have run — they are skipped precisely when
# pg_restore exits on ignorable errors, which the preparation above
# guarantees it does.
echo "==> Verifying the post-restore steps ran (ANALYZE, jit=off)"
never_analyzed="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.reltuples = -1;")"
[ "$never_analyzed" = "0" ] || fail "$never_analyzed restored tables were never ANALYZEd"

jit_setting="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
    WHERE d.datname = 'drill_dst' AND 'jit=off' = ANY(s.setconfig);")"
[ "$jit_setting" = "1" ] || fail "jit=off was not applied to the restored database"

echo "==> DRILL PASSED: backup -> restore reproduced data, RLS ($policy_count policies),"
echo "    $APP_ROLE's privileges ($grant_count table grants), statistics and jit=off"
echo "    on a clean database, restored as the migrator role on PostgreSQL $EXPECTED_PG_MAJOR."
