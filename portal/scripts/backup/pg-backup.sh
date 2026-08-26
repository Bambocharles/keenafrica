#!/usr/bin/env bash
# Logical backup of the portal database via pg_dump, run in a disposable
# Docker container so the host never needs a matching postgres-client
# install. Writes a timestamped custom-format dump, sanity-checks the
# archive, and prunes old dumps per a daily/weekly/monthly retention
# schedule. See ../../docs/BACKUP_RESTORE.md for the full runbook.
#
# Required:
#   DATABASE_URL   Connection string for a role that BYPASSES RLS (the
#                   migrator role, kf_portal_prod_migrator in prod — NOT
#                   the app role. A dump taken as the RLS-scoped app role
#                   would silently omit almost every row: see
#                   docs/BACKUP_RESTORE.md, "Why the migrator role".
# Optional:
#   BACKUP_DIR     Where dumps are written. Default: ./backups
#   PG_IMAGE       Postgres image used to run pg_dump. Default: postgres:16-alpine
#                   Keep this in sync with the server's major version.
#   RETENTION_DAILY_DAYS    Default: 14
#   RETENTION_WEEKLY_WEEKS  Default: 8
#   RETENTION_MONTHLY_MONTHS Default: 6
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set to a role that bypasses RLS (the migrator role)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
RETENTION_DAILY_DAYS="${RETENTION_DAILY_DAYS:-14}"
RETENTION_WEEKLY_WEEKS="${RETENTION_WEEKLY_WEEKS:-8}"
RETENTION_MONTHLY_MONTHS="${RETENTION_MONTHLY_MONTHS:-6}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/portal-${timestamp}.dump"

echo "==> Dumping to $dump_file (image: $PG_IMAGE)"
docker run --rm \
  --network host \
  -v "$BACKUP_DIR":/backup \
  -e PGDUMP_URL="$DATABASE_URL" \
  "$PG_IMAGE" \
  bash -c 'pg_dump --format=custom --no-owner --no-privileges --dbname "$PGDUMP_URL" --file "/backup/'"$(basename "$dump_file")"'"'

if [ ! -s "$dump_file" ]; then
  echo "!! Dump file is empty or missing — treating as a failed backup." >&2
  rm -f "$dump_file"
  exit 1
fi

echo "==> Verifying archive is readable"
docker run --rm -v "$BACKUP_DIR":/backup "$PG_IMAGE" \
  pg_restore --list "/backup/$(basename "$dump_file")" > /dev/null

echo "==> OK: $(du -h "$dump_file" | cut -f1) at $dump_file"

# --- Retention pruning -------------------------------------------------
# Keep: every dump from the last N days, plus one per week (the Sunday-most
# recent at prune time) for W weeks, plus one per month for M months.
# Everything else is deleted. Dumps are matched by the UTC timestamp
# embedded in the filename, not mtime, so this is stable across restores
# of the backup directory itself.
python3 - "$BACKUP_DIR" "$RETENTION_DAILY_DAYS" "$RETENTION_WEEKLY_WEEKS" "$RETENTION_MONTHLY_MONTHS" <<'PYEOF'
import sys, re, os
from datetime import datetime, timedelta, timezone

backup_dir, daily_days, weekly_weeks, monthly_months = sys.argv[1:5]
daily_days = int(daily_days)
weekly_weeks = int(weekly_weeks)
monthly_months = int(monthly_months)

pattern = re.compile(r"^portal-(\d{8}T\d{6}Z)\.dump$")
now = datetime.now(timezone.utc)

files = []
for name in os.listdir(backup_dir):
    m = pattern.match(name)
    if not m:
        continue
    ts = datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    files.append((ts, os.path.join(backup_dir, name)))

files.sort()

keep = set()
daily_cutoff = now - timedelta(days=daily_days)
for ts, path in files:
    if ts >= daily_cutoff:
        keep.add(path)

# One per ISO week within the weekly window: the latest dump in each week.
weekly_cutoff = now - timedelta(weeks=weekly_weeks)
by_week = {}
for ts, path in files:
    if ts < weekly_cutoff:
        continue
    key = ts.isocalendar()[:2]  # (iso_year, iso_week)
    if key not in by_week or ts > by_week[key][0]:
        by_week[key] = (ts, path)
keep.update(path for ts, path in by_week.values())

# One per calendar month within the monthly window: the latest dump in each month.
monthly_cutoff = now - timedelta(days=31 * monthly_months)
by_month = {}
for ts, path in files:
    if ts < monthly_cutoff:
        continue
    key = (ts.year, ts.month)
    if key not in by_month or ts > by_month[key][0]:
        by_month[key] = (ts, path)
keep.update(path for ts, path in by_month.values())

removed = 0
for ts, path in files:
    if path not in keep:
        os.remove(path)
        removed += 1

print(f"==> Retention: kept {len(keep)}, removed {removed}, total considered {len(files)}")
PYEOF
