#!/usr/bin/env bash
# Session 31 (Assessments P0 root cause) — the single-process repro+capture
# tool sessions/31-assessments-p0-root-cause.md required. Sessions 27 and
# 30 both tried to catch this live by having a human (the site owner)
# eyeball pg_stat_activity/pg_locks in pgAdmin at roughly the same moment
# an agent fired an HTTP request in a separate chat-coordinated step — that
# missed the ~18-20s failure window every single time because message
# round-trip latency alone exceeds it (see portal/docs/GO_LIVE_READINESS.md
# section 6). This script does both halves — the DB watch loop and the
# real authenticated HTTP repro — from ONE process, so there is no
# chat-relay latency in the timing-critical path.
#
# Run this from a machine that has BOTH:
#   1. Direct network access to postgres01 with a role that can see other
#      backends' query text in pg_stat_activity (kf_portal_prod_migrator
#      recommended — see scripts/dev/p0-lock-watch.sql's header).
#   2. Network access to https://teacher.keenafrica.com and
#      https://student.keenafrica.com.
#
# Required env vars:
#   PROD_DATABASE_URL   Connection string for the role in (1) above.
#   TEACHER_COOKIE       Full `Cookie:` header value from a real, already
#                         logged-in (password + MFA already completed) QA
#                         TEACHER browser session. Getting this takes 30
#                         seconds by hand (log in normally in a browser,
#                         then copy the Cookie request header for any
#                         request from devtools' Network tab) and sidesteps
#                         needing to script Next.js's Server Action POST
#                         protocol (multipart body + scraped $ACTION_ID)
#                         blind, against production, with no way for this
#                         script's author to test it first. Never paste
#                         this value into chat/logs — it's a live session
#                         credential.
#   STUDENT_COOKIE        Same, for QA STUDENT.
# Optional env vars:
#   TEACHER_BASE_URL     Default https://teacher.keenafrica.com
#   STUDENT_BASE_URL     Default https://student.keenafrica.com
#   OUT_DIR               Default ./p0-capture-<UTC timestamp>
#   WATCH_INTERVAL_SECS   Default 0.3
#
# Output: $OUT_DIR/pg_watch.log (the tight-loop DB capture, timestamped)
# and $OUT_DIR/http_repro.log (every request's status/duration, timestamped
# to the same clock). Read them side by side — match a slow/500 request's
# wall-clock window in http_repro.log against pg_watch.log's rows in that
# same window; the row with the largest xact_age (or a "blocking_chain"
# row) in that window is the answer to Hypothesis 1.
set -euo pipefail

: "${PROD_DATABASE_URL:?Set PROD_DATABASE_URL to a role that can read other backends pg_stat_activity.query, see script header}"
: "${TEACHER_COOKIE:?Set TEACHER_COOKIE to a real logged-in QA TEACHER sessions Cookie header value}"
: "${STUDENT_COOKIE:?Set STUDENT_COOKIE to a real logged-in QA STUDENT sessions Cookie header value}"

TEACHER_BASE_URL="${TEACHER_BASE_URL:-https://teacher.keenafrica.com}"
STUDENT_BASE_URL="${STUDENT_BASE_URL:-https://student.keenafrica.com}"
WATCH_INTERVAL_SECS="${WATCH_INTERVAL_SECS:-0.3}"
OUT_DIR="${OUT_DIR:-./p0-capture-$(date -u +%Y%m%dT%H%M%SZ)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$OUT_DIR"
echo "==> Writing to $OUT_DIR"

# --- psql runner: native binary if present, else the same disposable-
# container pattern scripts/backup/pg-backup.sh already uses, so a machine
# with only Docker still works. -------------------------------------------
if command -v psql >/dev/null 2>&1; then
  run_psql() { psql "$PROD_DATABASE_URL" -X -q "$@"; }
else
  echo "==> No local psql found — running it via a disposable postgres:16-alpine container instead"
  # Piped over stdin instead of -f: the SQL file lives on the HOST, and a
  # host path passed to -f is meaningless inside the container's own
  # filesystem (this was a real bug, caught by testing against local dev
  # Postgres before handing this back).
  run_psql() {
    docker run --rm -i --network host \
      -e PGPASSWORD \
      postgres:16-alpine \
      psql "$PROD_DATABASE_URL" -X -q "$@"
  }
fi
run_watch_query() { run_psql < "$SCRIPT_DIR/p0-lock-watch.sql"; }

# --- Start the tight-loop DB watch in the background, same process tree --
echo "==> Starting pg_stat_activity/pg_locks watch (every ${WATCH_INTERVAL_SECS}s) -> $OUT_DIR/pg_watch.log"
(
  run_watch_query || true
  while true; do
    sleep "$WATCH_INTERVAL_SECS"
    run_watch_query || true
  done
) > "$OUT_DIR/pg_watch.log" 2>&1 &
WATCH_PID=$!
trap 'kill "$WATCH_PID" 2>/dev/null || true' EXIT

# Give the watch loop a couple of ticks to actually connect before we start
# generating load — this is the only sleep in the script, and it's local
# (no chat round-trip), unlike every prior attempt.
sleep 2

http_log() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) $*" | tee -a "$OUT_DIR/http_repro.log"; }

# curl's own timing: total time + HTTP status, no dependency on this
# script's own clock skew for the duration figure. --max-time bounds a
# TRUE hang (server never responds at all, as opposed to a slow 500) to
# 90s so this can never block forever and needs no ps-aux troubleshooting
# to notice — a "status=000" row in http_repro.log IS that finding.
timed_get() {
  local label="$1" url="$2" cookie="$3"
  local result
  result="$(curl -sS --max-time 90 -o /dev/null -w '%{http_code} %{time_total}' -H "Cookie: $cookie" "$url" || echo "000 90.000")"
  http_log "$label -> status=$(echo "$result" | awk '{print $1}') duration=$(echo "$result" | awk '{print $2}')s"
}

echo "==> Solo repro: teacher, then student" | tee -a "$OUT_DIR/http_repro.log"
timed_get "solo teacher" "$TEACHER_BASE_URL/assessments" "$TEACHER_COOKIE"
timed_get "solo student" "$STUDENT_BASE_URL/assessments" "$STUDENT_COOKIE"

sleep 2

# wait -p / listing explicit PIDs (not bare `wait`, which would also block
# on the still-running background watch loop above and hang forever) --
echo "==> 3-way concurrent burst: teacher" | tee -a "$OUT_DIR/http_repro.log"
burst_pids=()
for i in 1 2 3; do
  timed_get "concurrent teacher #$i" "$TEACHER_BASE_URL/assessments" "$TEACHER_COOKIE" &
  burst_pids+=("$!")
done
wait "${burst_pids[@]}"

sleep 2

echo "==> 3-way concurrent burst: student" | tee -a "$OUT_DIR/http_repro.log"
burst_pids=()
for i in 1 2 3; do
  timed_get "concurrent student #$i" "$STUDENT_BASE_URL/assessments" "$STUDENT_COOKIE" &
  burst_pids+=("$!")
done
wait "${burst_pids[@]}"

# Let the watch loop capture a few more ticks after the last request
# settles/times out before stopping it.
sleep 25

kill "$WATCH_PID" 2>/dev/null || true
trap - EXIT

echo "==> Done. Read $OUT_DIR/http_repro.log and $OUT_DIR/pg_watch.log side by side:"
echo "    for each slow/500 request's timestamp window, find the pg_watch.log"
echo "    snapshot(s) inside that window and look at the top row (largest"
echo "    xact_age) and any 'blocking_chain' rows."
echo "==> Also worth cross-checking against fresh app logs from the other"
echo "    side (kubectl logs -n keen-prod -l app=portal --since=5m), which"
echo "    a separate, kubectl-only sandbox in this same conversation COULD"
echo "    read (but not exec/get secrets) — the P2028 error timestamps"
echo "    there should line up with this script's http_repro.log timestamps."
