-- Session 33 (Data Integrity Investigation) — Part 1: what emptied
-- assessment_assignments/attempts in production?
--
-- Run this against keenafrica_portal_prod, ideally as kf_portal_prod_migrator
-- (or another role with pg_read_all_stats / superuser) so query #2's
-- pg_stat_user_tables counters and query #1's row counts are both visible.
-- Read-only throughout — every statement below is a SELECT.
--
-- Usage:  psql "$PROD_DATABASE_URL" -f scripts/dev/p1-data-wipe-investigation.sql
-- (or paste each numbered block into pgAdmin's Query Tool one at a time)
--
-- Paste the full output back — none of it is a secret (row counts, audit
-- log rows, cumulative insert/delete counters).

\echo '=== 1. Current row counts (confirms still empty, not a stale finding) ==='
SELECT 'attempts' AS table_name, count(*) FROM attempts
UNION ALL
SELECT 'assessment_assignments', count(*) FROM assessment_assignments;

\echo '=== 2. Cumulative insert/delete counters since last stats reset ==='
-- If n_tup_ins = 0, no row was EVER inserted into that table in production
-- (rules out "wipe" entirely — the table was simply never populated).
-- If n_tup_ins > 0 and n_tup_del ~= n_tup_ins with current count 0, a real
-- delete/wipe happened and we need query #3 to find out via what path.
-- stats_reset tells you how far back these counters actually go — if it's
-- recent, this evidence is inconclusive and should be discounted.
SELECT
  relname AS table_name,
  n_tup_ins AS total_inserted,
  n_tup_upd AS total_updated,
  n_tup_del AS total_deleted,
  n_live_tup AS live_rows_now,
  n_dead_tup AS dead_rows_now,
  last_autovacuum,
  last_vacuum
FROM pg_stat_user_tables
WHERE relname IN ('attempts', 'assessment_assignments', 'assessments', 'assessment_versions')
ORDER BY relname;

\echo '=== 2b. Stats reset time for the whole database (invalidates #2 if recent) ==='
SELECT datname, stats_reset FROM pg_stat_database WHERE datname = current_database();

\echo '=== 3. Every audit_events row touching attempts/assessment_assignments or their creation/removal actions, full history ==='
SELECT id, actor_id, action, entity_type, entity_id, metadata, ip_address, created_at
FROM audit_events
WHERE entity_type IN ('Attempt', 'Assessment', 'AssessmentAssignment')
   OR action LIKE 'attempt.%'
   OR action LIKE 'assessment.%'
ORDER BY created_at ASC;

\echo '=== 4. Any audit_events row shaped like a bulk delete/reset/seed action, full history (not just assessments) ==='
SELECT id, actor_id, action, entity_type, entity_id, metadata, ip_address, created_at
FROM audit_events
WHERE action ILIKE '%delete%' OR action ILIKE '%reset%' OR action ILIKE '%wipe%' OR action ILIKE '%truncate%' OR action ILIKE '%seed%'
ORDER BY created_at ASC;

\echo '=== 5. Does the database itself show a demo-seed-shaped row ever having existed (roles/permissions/feature-flags seed markers)? ==='
-- Sanity check only: super_admin/roles/permissions rows are ALSO created by
-- the seed task (rolesPermissionsTask/superAdminTask), so if THOSE show a
-- seed-shaped creation timestamp far earlier than assessment_core shipped,
-- that's expected (Session 01/02) and not evidence of a later reset.
SELECT min(created_at) AS earliest_role, max(created_at) AS latest_role FROM roles;

\echo '=== 6. Certificate/Asset attribution — is certificate-KA-2026-2FB5355B6CA3.txt a QA fixture or a real record? ==='
SELECT
  a.id AS asset_id, a.original_filename, a.size_bytes, a.created_at AS asset_created_at,
  c.id AS certificate_id, c.certificate_number, c.student_name_snapshot, c.course_title_snapshot,
  c.completed_at, c.issued_at,
  u.id AS student_user_id, u.email AS student_email, u.name AS student_name,
  co.id AS course_id, co.title AS course_title
FROM assets a
JOIN asset_attachments aa ON aa.asset_id = a.id AND aa.entity_type = 'certificate'
JOIN certificates c ON c.id = aa.entity_id
JOIN users u ON u.id = c.student_user_id
JOIN courses co ON co.id = c.course_id
WHERE a.original_filename = 'certificate-KA-2026-2FB5355B6CA3.txt';

\echo '=== 7. Every certificate ever issued in production, for context on #6 ==='
SELECT c.certificate_number, u.email AS student_email, co.title AS course_title, c.completed_at, c.issued_at
FROM certificates c
JOIN users u ON u.id = c.student_user_id
JOIN courses co ON co.id = c.course_id
ORDER BY c.issued_at ASC;
