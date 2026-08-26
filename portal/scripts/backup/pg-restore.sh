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

echo "==> Restore command completed. Run your own row-count/spot-check queries against the target before trusting it."
