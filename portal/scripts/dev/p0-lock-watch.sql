-- Session 31 (Assessments P0 root cause) — the diagnostic query Sessions
-- 27/29/30 never managed to run synchronized with a live repro (see
-- portal/docs/GO_LIVE_READINESS.md section 6 and
-- portal/docs/QA_STUDENT_LIVE_PASS.md's Bug 1). Run this via
-- scripts/dev/p0-capture-and-repro.sh, not by hand — that script starts
-- this watch loop and fires the real HTTP repro from the SAME process, so
-- there is no chat-relay latency between "start watching" and "trigger the
-- failure" the way every prior attempt had.
--
-- Every ~300ms this prints ALL backends on the production database
-- (oldest transaction first — an idle-in-transaction session that never
-- committed/rolled back, Hypothesis 1 in sessions/31-assessments-p0-root-
-- cause.md, will sit at the top with a large xact_age and typically
-- state='idle in transaction'), PLUS an explicit blocked/blocking-pid pair
-- for any backend that is currently waiting on a lock someone else holds.
--
-- Requires a role that can see OTHER backends' query text in
-- pg_stat_activity (superuser, or a role granted pg_read_all_stats) —
-- Session 30 flagged that the `keen` role's exact privilege level here was
-- never confirmed. Use kf_portal_prod_migrator if available.
WITH activity AS (
  SELECT
    'activity'::text AS kind,
    pid,
    usename,
    state,
    wait_event_type,
    wait_event AS wait_event_or_note,
    now() - xact_start AS xact_age,
    now() - query_start AS query_age,
    left(coalesce(query, ''), 4000) AS query
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
),
blockers AS (
  SELECT
    'blocking_chain'::text AS kind,
    blocked.pid AS pid,
    blocked.usename,
    blocked.state,
    NULL::text AS wait_event_type,
    ('WAITING on pid ' || blocking.pid || ' (' || blocking.state || ')')::text AS wait_event_or_note,
    now() - blocked.xact_start AS xact_age,
    now() - blocked.query_start AS query_age,
    left(coalesce(blocked.query, ''), 4000) AS query
  FROM pg_locks bl
  JOIN pg_stat_activity blocked ON blocked.pid = bl.pid AND NOT bl.granted
  JOIN pg_locks kl ON kl.locktype = bl.locktype
    AND kl.database IS NOT DISTINCT FROM bl.database
    AND kl.relation IS NOT DISTINCT FROM bl.relation
    AND kl.page IS NOT DISTINCT FROM bl.page
    AND kl.tuple IS NOT DISTINCT FROM bl.tuple
    AND kl.virtualxid IS NOT DISTINCT FROM bl.virtualxid
    AND kl.transactionid IS NOT DISTINCT FROM bl.transactionid
    AND kl.classid IS NOT DISTINCT FROM bl.classid
    AND kl.objid IS NOT DISTINCT FROM bl.objid
    AND kl.objsubid IS NOT DISTINCT FROM bl.objsubid
    AND kl.pid != bl.pid
  JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
  WHERE kl.granted
)
SELECT clock_timestamp() AS captured_at, *
FROM (SELECT * FROM blockers UNION ALL SELECT * FROM activity) AS combined
ORDER BY kind DESC, xact_age DESC NULLS LAST;
