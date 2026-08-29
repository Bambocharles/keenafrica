-- Session 29 (QA: Security/RLS) — found live, against the real non-superuser
-- portal_rls_test role: cohort_relationship_user_visibility's (Session 26)
-- users_select branches leak an organization-scoped cohort's teacher/
-- classmate identity (name + email, via every real caller's own
-- `select: { id, name, email }` shape — src/lib/courses.ts's
-- listEnrollmentsForCohort, src/lib/progress.ts's
-- getCourseProgressForCohort, src/lib/messaging.ts's
-- listMessageableStudentsForTeacher/listMessageableForStudent) to a caller
-- who is NOT an active member of that organization.
--
-- Root cause: the student-facing branches ("student sees teacher of a
-- cohort they're enrolled in", "student sees a classmate in a shared
-- cohort") drive through app_current_user_enrolled_cohort_ids() — a
-- SECURITY DEFINER helper (Session 09) that returns the caller's own raw
-- enrollment cohort_ids with NO organization check, by original design
-- (it exists purely to dodge enrollments_select's own recursion, not to
-- gate anything). Session 21 (Organization-Aware Education) added an
-- explicit organization_id condition to enrollments_select/cohorts_select/
-- courses_select themselves, but Session 26 layered users_select's new
-- branches on top of the SECURITY-DEFINER helpers directly, which bypass
-- table RLS entirely (that's the whole point of SECURITY DEFINER) — so
-- Session 21's boundary was silently never applied to these three new
-- branches. The teacher-facing branch ("teacher sees student") happened to
-- cascade correctly by accident, because its own SECURITY DEFINER helper
-- (app_current_user_taught_cohort_ids()) is only used to pick cohort_ids,
-- and the actual row-selection subquery still queries `enrollments e`
-- directly (not through a bypass helper) — so enrollments_select's own
-- org-aware policy is re-applied by Postgres. Confirmed via a new
-- adversarial test added to
-- organization-aware-education-rls.integration.test.ts, run against the
-- real portal_rls_test role (not the superuser dev connection, which
-- bypasses RLS regardless of policy).
--
-- Real-world trigger, not just a bypassed-fixture edge case: any student
-- (or teacher) whose OrganizationMembership becomes non-active (left,
-- removed, suspended) after enrolling in / being assigned to an
-- organization-scoped cohort. Enrollment/cohort_teachers rows are not
-- automatically cleaned up on membership-status changes (an
-- already-documented gap — see Session 21/24's handoffs) — every such
-- account retains this leak indefinitely, going forward, from every login
-- after their membership actually ends, contradicting the resolveSessionAuthz()
-- guarantee ("an org membership change takes effect on the target's very
-- next request") this same session verified holds everywhere else.
--
-- Fix: add the identical "organization_id IS NULL OR organization_id IN
-- app.organization_ids" condition (via app_cohort_organization_id(),
-- already defined by organization_aware_education) to the cohort_id
-- lookup itself, on ALL THREE cohort-relationship branches — including the
-- teacher-sees-student branch, which already cascaded correctly through
-- enrollments_select, so this is a pure no-op there. Made explicit on all
-- three anyway (belt-and-suspenders), matching this codebase's own
-- established convention (assessments_select/questions_select's identical
-- reasoning in the organization_aware_education migration): this policy's
-- correctness must never again silently depend on a SECURITY DEFINER
-- helper's future shape.
DROP POLICY "users_select" ON "users";
CREATE POLICY "users_select" ON "users" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "users"."id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_lookup', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
  OR current_setting('app.self_registration', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.create'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.update'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.suspend'
  -- Teacher sees an actively enrolled student in a cohort the actor teaches.
  OR "users"."id" IN (
    SELECT e.student_user_id FROM enrollments e
    WHERE e.cohort_id IN (SELECT app_current_user_taught_cohort_ids())
      AND e.status IN ('active', 'completed')
      AND (
        app_cohort_organization_id(e.cohort_id) IS NULL
        OR app_cohort_organization_id(e.cohort_id)::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
        )
      )
  )
  -- Student sees a teacher of a cohort the actor is actively enrolled in.
  OR "users"."id" IN (
    SELECT ct.teacher_user_id FROM cohort_teachers ct
    WHERE ct.cohort_id IN (SELECT app_current_user_enrolled_cohort_ids())
      AND (
        app_cohort_organization_id(ct.cohort_id) IS NULL
        OR app_cohort_organization_id(ct.cohort_id)::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
        )
      )
  )
  -- Student sees a fellow actively-enrolled classmate in a shared cohort.
  OR "users"."id" IN (
    SELECT e.student_user_id FROM enrollments e
    WHERE e.cohort_id IN (SELECT app_current_user_enrolled_cohort_ids())
      AND e.status IN ('active', 'completed')
      AND (
        app_cohort_organization_id(e.cohort_id) IS NULL
        OR app_cohort_organization_id(e.cohort_id)::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
        )
      )
  )
);
