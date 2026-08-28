-- Session 26 (QA Teacher) — found live in production: users_select had no
-- branch at all for "actor shares an active cohort relationship with this
-- user" (teacher-sees-own-student, student-sees-own-teacher, or
-- student-sees-cohort-mate). Every one of these relationships is already
-- an intended, shipped feature — Session 04/05's cohort roster
-- (src/lib/courses.ts's listEnrollmentsForCohort, `include: { student }`),
-- Session 08's per-student progress (src/lib/progress.ts's
-- getCourseProgressForCohort, same include shape), and Session 09's
-- messaging compose pickers (src/lib/messaging.ts's
-- listMessageableStudentsForTeacher/listMessageableForStudent) all
-- relationally `include` a User row from a cohort_teachers/enrollments
-- row the actor IS authorized to read. A relational include in Prisma
-- still applies the JOINED table's own RLS policy under the actor's
-- session context, independent of whether the actor is authorized to read
-- the OUTER row — and a plain TEACHER/STUDENT (no users.read/users.create/
-- users.update/users.suspend permission) was never granted any users_select
-- branch covering this, so every one of those reads threw
-- PrismaClientUnknownRequestError ("Field student/teacher is required to
-- return data, got null instead.") under real RLS enforcement (production's
-- kf_portal_prod_app role — the local dev superuser connection always
-- bypasses RLS, which is why nothing caught this before a QA session
-- actually exercised a real teacher/student pair against real production).
--
-- This is a pure, additive read-visibility widening — mirrors the exact
-- "classmate seeing a fellow student is enrolled in the same cohort, same
-- as a real classroom roster already exposes" precedent the
-- messaging_cohort_visibility migration (Session 09) already established
-- for cohort_teachers/enrollments themselves, applied one level further to
-- the User row those relationships already legitimately reference. No
-- existing branch of users_select is changed or narrowed.
--
-- Deliberately does NOT duplicate Organization-Aware Education's (Session
-- 21) org-membership check here: cohort_teachers_select/enrollments_select
-- already gate discovery of the underlying relationship on the correct
-- organization scope (see organization_aware_education migration) — if the
-- actor can already see the cohort_teachers/enrollments row connecting
-- them to this user, granting visibility into that same already-authorized
-- counterpart's User row adds no new exposure.
--
-- NOTE ON RECURSION: users_select must not directly subquery
-- cohort_teachers/enrollments (whose own policies could, transitively,
-- reference users) — same recursion class documented in the
-- messaging_cohort_visibility/organization_aware_education migrations.
-- Both new SECURITY DEFINER functions below run as the table owner
-- (bypass RLS entirely, opaque to the RLS rewriter), same convention as
-- app_current_user_enrolled_cohort_ids() (Session 09).

CREATE FUNCTION app_current_user_taught_cohort_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cohort_id FROM cohort_teachers
  WHERE teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
$$;

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
  )
  -- Student sees a teacher of a cohort the actor is actively enrolled in.
  OR "users"."id" IN (
    SELECT ct.teacher_user_id FROM cohort_teachers ct
    WHERE ct.cohort_id IN (SELECT app_current_user_enrolled_cohort_ids())
  )
  -- Student sees a fellow actively-enrolled classmate in a shared cohort.
  OR "users"."id" IN (
    SELECT e.student_user_id FROM enrollments e
    WHERE e.cohort_id IN (SELECT app_current_user_enrolled_cohort_ids())
      AND e.status IN ('active', 'completed')
  )
);
