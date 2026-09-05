-- Landed by Session 45 (Outstanding Fixes & Consolidation). Reconstructed
-- from Session 33's never-merged checkpoint commit (b63cae2 on
-- session-33-data-integrity-rls-depth-audit) and re-verified against the
-- live production policy before shipping: as of 2026-09-05, production's
-- answers_select/answers_update still carried the pre-fix
-- join-through-"assessments" shape below, confirmed by querying pg_policy
-- on keenafrica_portal_prod directly. Renamed from 20260831140000 to a
-- current timestamp so it applies after the Session 34-44 migrations that
-- landed while it sat unmerged (the folder was never applied anywhere, so
-- renaming it is safe).
--
-- Session 33 (Data Integrity Investigation & RLS Depth Audit, Part 2) —
-- systemic audit of every RLS policy for the same JIT-compilation-threshold
-- risk Session 31 found and fixed in attempts_select/attempts_update (see
-- that session's handoff and the 20260831100000_attempts_course_id_
-- denormalization migration). Method: dumped every live policy from
-- pg_policies, built a table-reference graph from every EXISTS/JOIN target,
-- then ran EXPLAIN under the real portal_rls_test role (a user id matching
-- nothing, no permissions, not super_admin — forces every OR branch,
-- including the EXISTS subqueries, to actually be evaluated) for every
-- table whose SELECT policy's reference chain reaches 3+ RLS-protected
-- tables. 21 candidate tables were checked this way; 20 already join
-- through an already-denormalized *_id column (e.g. lesson_progress joins
-- cohort_teachers/cohorts directly via its own course_id) and came back
-- with estimated costs in the hundreds-to-low-thousands. One did not:
--
-- answers_select/answers_update's teacher branch: cost 36,300.84 (127 plan
-- nodes) against a fixture of ~dozens of rows — 4-28x every other
-- candidate's cost on the exact same fixture size, and structurally
-- identical to attempts_select's PRE-FIX shape: EXISTS (SELECT 1 FROM
-- attempts att JOIN assessments asm ON asm.id = att.assessment_id JOIN
-- cohorts c ON c.course_id = asm.course_id JOIN cohort_teachers ct ON
-- ct.cohort_id = c.id WHERE ...) — a join THROUGH "assessments", which
-- pulls in assessments_select's entire policy (itself referencing
-- assessment_assignments and cohorts again), the exact same "3-4 tables
-- deep, invisible on tiny fixtures" shape that tripped Postgres's JIT
-- threshold for attempts_select in production. answers was not touched by
-- Session 31 because that session was root-causing one specific reported
-- symptom (student /assessments), not auditing the schema — this is
-- exactly the systemic follow-up Session 31's own handoff flagged as
-- unaudited.
--
-- Fix: identical pattern to Session 31's attempts fix, and cheaper here —
-- attempts.course_id already exists (added by the 20260831100000
-- migration, NOT NULL, immutable once an attempt is created — see that
-- migration's own comment). No new column needed; answers_select/
-- answers_update's teacher branch now joins "attempts" straight to
-- "cohorts" via att.course_id instead of hopping through "assessments".
--
-- ACCESS IS PROVABLY IDENTICAL, not just faster: the removed hop was
-- att JOIN assessments asm ON asm.id = att.assessment_id JOIN cohorts c ON
-- c.course_id = asm.course_id — i.e. "the cohort of the course that owns
-- the assessment this attempt belongs to." att.course_id was backfilled by
-- the 20260831100000 migration from that exact same assessments.course_id
-- value and can never drift from it (attempts.assessment_id is immutable
-- post-creation, per src/lib/attempts.ts; assessments.course_id is
-- immutable post-creation, per src/lib/assessments.ts). So
-- "cohorts c ON c.course_id = att.course_id" resolves to the identical set
-- of cohort rows as "cohorts c ON c.course_id = asm.course_id" did — this
-- removes a redundant path to the same check, it does not change which
-- rows a teacher can see. answers_write (student-only INSERT, no teacher
-- branch) is untouched — nothing to fix there.

DROP POLICY "answers_select" ON "answers";
CREATE POLICY answers_select ON "answers" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM attempts att WHERE att.id = "answers"."attempt_id"
    AND att.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR EXISTS (
    SELECT 1 FROM attempts att JOIN cohorts c ON c.course_id = att.course_id
    JOIN cohort_teachers ct ON ct.cohort_id = c.id
    WHERE att.id = "answers"."attempt_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

DROP POLICY "answers_update" ON "answers";
CREATE POLICY answers_update ON "answers" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM attempts att WHERE att.id = "answers"."attempt_id"
    AND att.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND att.status = 'in_progress'
  )
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM attempts att JOIN cohorts c ON c.course_id = att.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE att.id = "answers"."attempt_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM attempts att WHERE att.id = "answers"."attempt_id"
    AND att.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM attempts att JOIN cohorts c ON c.course_id = att.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE att.id = "answers"."attempt_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
