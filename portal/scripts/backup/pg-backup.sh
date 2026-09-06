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
#   EXPECTED_PG_MAJOR  Production's Postgres major version. Default: 14.
#                   Both the client image and the live server are checked
#                   against it and the backup refuses to run on a mismatch
#                   (Session 49; see docs/GO_LIVE_READINESS.md §11.2(c)).
#   PG_IMAGE       Postgres image used to run pg_dump.
#                   Default: postgres:$EXPECTED_PG_MAJOR-alpine
#   ALLOW_PG_MAJOR_MISMATCH=yes  Escape hatch to dump anyway.
#   RETENTION_DAILY_DAYS    Default: 14
#   RETENTION_WEEKLY_WEEKS  Default: 8
#   RETENTION_MONTHLY_MONTHS Default: 6
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set to a role that bypasses RLS (the migrator role)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
EXPECTED_PG_MAJOR="${EXPECTED_PG_MAJOR:-14}"
PG_IMAGE="${PG_IMAGE:-postgres:${EXPECTED_PG_MAJOR}-alpine}"
ALLOW_PG_MAJOR_MISMATCH="${ALLOW_PG_MAJOR_MISMATCH:-no}"
RETENTION_DAILY_DAYS="${RETENTION_DAILY_DAYS:-14}"
RETENTION_WEEKLY_WEEKS="${RETENTION_WEEKLY_WEEKS:-8}"
RETENTION_MONTHLY_MONTHS="${RETENTION_MONTHLY_MONTHS:-6}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

# --- Version reconciliation (Session 49, docs/GO_LIVE_READINESS.md §11.2(c))
# This script used to default to postgres:16-alpine while production runs
# PostgreSQL 14.24 — directly against PG_IMAGE's own documented contract.
# Every dump it took was therefore written in archive format 1.15, which
# PostgreSQL 14's own pg_restore cannot read at all ("unsupported version
# (1.15) in file header"). The backups looked fine; they were simply
# unreadable by tooling matched to the server they came from, which is the
# tooling an operator rebuilding postgres01 would have. Pin the image to the
# server's major version, and verify both ends rather than trusting the
# default to stay correct after the next Postgres upgrade.
client_version="$(docker run --rm "$PG_IMAGE" pg_dump --version | awk '{print $NF}')"
client_major="${client_version%%.*}"
server_version_num="$(docker run --rm --network host -e PGDUMP_URL="$DATABASE_URL" "$PG_IMAGE" \
  bash -c 'psql -X --quiet --no-psqlrc -tA -d "$PGDUMP_URL" -c "SHOW server_version_num"')"
server_major="$(( server_version_num / 10000 ))"

if { [ "$client_major" != "$EXPECTED_PG_MAJOR" ] || [ "$server_major" != "$EXPECTED_PG_MAJOR" ]; } \
   && [ "$ALLOW_PG_MAJOR_MISMATCH" != "yes" ]; then
  echo "!! VERSION MISMATCH — refusing to take a backup that cannot be restored by" >&2
  echo "!! tooling matched to the server it came from." >&2
  echo "!!   pg_dump (from PG_IMAGE=$PG_IMAGE): $client_version (major $client_major)" >&2
  echo "!!   live server: major $server_major (server_version_num=$server_version_num)" >&2
  echo "!!   EXPECTED_PG_MAJOR: $EXPECTED_PG_MAJOR" >&2
  echo "!! If production was upgraded, update EXPECTED_PG_MAJOR here and in" >&2
  echo "!! scripts/backup/pg-restore.sh, and say so in docs/BACKUP_RESTORE.md." >&2
  echo "!! Set ALLOW_PG_MAJOR_MISMATCH=yes to override deliberately." >&2
  exit 1
fi
echo "==> Version check OK: pg_dump $client_version against server major $server_major (expected $EXPECTED_PG_MAJOR)"

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
