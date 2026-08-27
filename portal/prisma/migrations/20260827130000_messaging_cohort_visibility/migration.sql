-- Session 09 (Messaging) — additive RLS widening on Education Core's
-- (Session 04) cohort_teachers/enrollments tables. Two required use cases
-- (sessions/09-messaging.md: "Student -> teacher", "Student -> permitted
-- student") need a plain STUDENT actor to discover (a) who teaches their
-- own cohort and (b) who their fellow cohort-mates are, so
-- src/lib/messaging.ts's assertCanMessage()/listMessageableForStudent() can
-- run entirely under the acting student's own RLS context rather than some
-- new "internal system bypass" mechanism. Neither read was previously
-- possible for a plain student:
--   - cohort_teachers_select was self(teacher)-or-courses.manage-or-
--     super_admin only.
--   - enrollments_select was self(student)-or-that-cohort's-teacher-or-
--     courses.manage-or-super_admin only.
-- This is a read-visibility extension, not a new relationship model — the
-- underlying CohortTeacher/Enrollment rows remain Session 04's canonical
-- data, unchanged. A classmate seeing "this student is enrolled in this
-- cohort" (no grades, no other PII) is the same information a real
-- classroom roster already exposes.
--
-- NOTE ON RECURSION: cohort_teachers_select needs "is the requester
-- enrolled in this row's cohort" (an enrollments fact), and
-- enrollments_select needs "does the requester share this row's cohort as
-- a fellow student" (also an enrollments fact, self-referential). A raw
-- subquery from cohort_teachers_select into enrollments — which already
-- subqueries cohort_teachers in its own policy — or a raw self-subquery
-- within enrollments_select referencing enrollments itself, reproduces the
-- exact "infinite recursion detected in policy" failure class documented in
-- the assessment_core/assets_files/messaging_core migrations. Both new
-- branches below go through app_current_user_enrolled_cohort_ids(), a
-- SECURITY DEFINER function (same convention as messaging_core's
-- app_current_user_conversation_ids()) that runs as the table owner
-- (bypasses RLS entirely, opaque to the RLS rewriter), so neither policy
-- ever re-triggers the other or itself.
CREATE FUNCTION app_current_user_enrolled_cohort_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cohort_id FROM enrollments
  WHERE student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND status IN ('active', 'completed')
$$;

DROP POLICY "cohort_teachers_select" ON "cohort_teachers";
CREATE POLICY "cohort_teachers_select" ON "cohort_teachers" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "cohort_teachers"."teacher_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "cohort_teachers"."cohort_id" IN (SELECT app_current_user_enrolled_cohort_ids())
);

DROP POLICY "enrollments_select" ON "enrollments";
CREATE POLICY "enrollments_select" ON "enrollments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct WHERE ct.cohort_id = "enrollments"."cohort_id"
      AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR "enrollments"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "enrollments"."cohort_id" IN (SELECT app_current_user_enrolled_cohort_ids())
);
