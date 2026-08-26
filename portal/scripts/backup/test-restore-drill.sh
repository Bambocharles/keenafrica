#!/usr/bin/env bash
# Restore drill: proves a real dump actually restores into a clean database
# with matching data and intact RLS, using only disposable Docker
# containers. Safe to run anywhere Docker is available — never touches a
# real/shared database.
#
# Run this:
#  - after any change to the schema, migration, or backup/restore scripts
#  - periodically (e.g. quarterly) against a real prod dump, as a genuine
#    DR exercise — see docs/BACKUP_RESTORE.md
#
# What it does:
#   1. Starts an ephemeral source Postgres, applies all migrations.
#   2. Inserts a marker row.
#   3. Runs pg-backup.sh against it.
#   4. Starts a second, empty ephemeral Postgres ("the disaster").
#   5. Runs pg-restore.sh into it.
#   6. Asserts the marker row + RLS policies survived, then tears both down.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # -> portal/

SRC_CONTAINER="portal-drill-src-$$"
DST_CONTAINER="portal-drill-dst-$$"
DRILL_DIR="$(mktemp -d)"
SRC_PORT=55501
DST_PORT=55502

cleanup() {
  docker rm -f "$SRC_CONTAINER" "$DST_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

echo "==> Starting ephemeral source DB ($SRC_CONTAINER)"
docker run -d --name "$SRC_CONTAINER" \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill_src \
  -p "$SRC_PORT":5432 postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$SRC_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

SRC_URL="postgresql://postgres:drill@localhost:${SRC_PORT}/drill_src"
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
  -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill_dst \
  -p "$DST_PORT":5432 postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$DST_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;" >/dev/null

DST_URL="postgresql://postgres:drill@localhost:${DST_PORT}/drill_dst"
echo "==> Running pg-restore.sh"
RESTORE_CONFIRM=yes ./scripts/backup/pg-restore.sh "$dump_file" "$DST_URL"

echo "==> Verifying marker row survived the round trip"
found="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM sponsors WHERE name = '$MARKER';")"
if [ "$found" != "1" ]; then
  echo "!! DRILL FAILED: marker row not found after restore (count=$found)" >&2
  exit 1
fi

echo "==> Verifying RLS survived the round trip"
policy_count="$(docker exec "$DST_CONTAINER" psql -U postgres -d drill_dst -tAc \
  "SELECT count(*) FROM pg_policies;")"
if [ "$policy_count" -lt 1 ]; then
  echo "!! DRILL FAILED: no RLS policies present after restore" >&2
  exit 1
fi

echo "==> DRILL PASSED: backup -> restore reproduced data and RLS ($policy_count policies) on a clean database."
