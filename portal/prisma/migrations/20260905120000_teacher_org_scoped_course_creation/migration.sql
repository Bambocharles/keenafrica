-- Session 45 (Outstanding Fixes & Consolidation) — teacher org-scoped course
-- creation, the RLS half.
--
-- Implements the decision recorded in status/project-status.md on
-- 2026-08-31 ("Teachers may create courses, but only organization-scoped
-- ones, for organizations they belong to — not platform-wide
-- courses.create/courses.manage rights like Admin") which no session
-- between 21 and 44 ever landed.
--
-- WHY A NEW PERMISSION KEY RATHER THAN GRANTING TEACHER courses.create:
-- courses_select (education_core, rewritten by organization_aware_education)
-- contains a bare `? 'courses.create'` branch — any holder of that key sees
-- EVERY course on the platform, of every organization. Granting TEACHER
-- courses.create to enable creation would therefore have silently opened a
-- platform-wide course-visibility hole. courses.create.organization appears
-- in no SELECT policy at all; it is a creation-only key, and is
-- insufficient on its own — the row must also be organization-scoped to an
-- organization in the caller's server-resolved app.organization_ids.
--
-- Two policies change:
--
-- 1. courses_write (INSERT) — gains a fourth branch. Note it is written
--    against the NEW row's own columns (WITH CHECK sees the proposed row),
--    so it constrains what a courses.create.organization holder may insert:
--    scope must be 'organization', organization_id must be non-null, and
--    that organization must be one the caller is an active member of
--    (app.organization_ids is resolved server-side by withRls() from
--    OrganizationMembership — never from client input, per
--    PLATFORM_ARCHITECTURE.md §15). A platform-scoped INSERT
--    (organization_id IS NULL) fails this branch and, lacking
--    courses.create, fails the policy entirely.
--
--    The existing super_admin and courses.create branches are untouched: an
--    ADMIN/SUPER_ADMIN can still create anything, platform or
--    organization-scoped, member or not. This migration only ADDS a
--    narrower path; it takes nothing away.
--
-- 2. courses_select — gains a created_by branch. Required, not cosmetic:
--    Postgres applies a table's SELECT policy to INSERT ... RETURNING, which
--    is how Prisma's create() reads the new row back, so without this the
--    teacher's own INSERT would succeed and then fail to return. It also
--    keeps the course visible in their own workspace (listMyCourses) before
--    an admin has attached a cohort. It carries the SAME organization guard
--    as the teacher-of-cohort branch immediately above it: a creator who is
--    later removed from the organization stops seeing the course, exactly
--    like a teacher removed from it would. For every course that exists
--    today this branch is a no-op — before this session only
--    courses.create holders (ADMIN/SUPER_ADMIN) could create a course at
--    all, and both already match an earlier branch unconditionally.
--
-- NOT changed, deliberately: cohorts_write/cohort_teachers_write remain
-- courses.manage-only. A teacher can create an organization-scoped course
-- but cannot yet create its cohorts or assign themselves to teach it —
-- that stays an admin action. Widening it is a real product decision beyond
-- this session's brief (which asks only for course creation) and is flagged
-- in the handoff rather than assumed here.

DROP POLICY "courses_write" ON "courses";
CREATE POLICY courses_write ON "courses" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.create'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.create.organization'
    AND "courses"."scope" = 'organization'
    AND "courses"."organization_id" IS NOT NULL
    AND "courses"."organization_id"::text = ANY (
      SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
    )
  )
);

DROP POLICY "courses_select" ON "courses";
CREATE POLICY courses_select ON "courses" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.create'
  OR (
    EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "courses"."id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    AND (
      "courses"."organization_id" IS NULL
      OR "courses"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
  OR (
    "courses"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid
    AND (
      "courses"."organization_id" IS NULL
      OR "courses"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
  OR (
    "courses"."status" IN ('published', 'archived')
    AND EXISTS (
      SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
      WHERE c.course_id = "courses"."id" AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND e.status IN ('active', 'completed')
    )
    AND (
      "courses"."organization_id" IS NULL
      OR "courses"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
);
