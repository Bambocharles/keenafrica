-- Session 21 (Organization-Aware Education) — Course/Cohort/Enrollment
-- gain their first tenant boundary. Course/Cohort/Enrollment/Module/
-- Lesson/Assessment/Question had ZERO organization-scoping fields before
-- this migration; courses_select granted access via the global
-- courses.manage/courses.create permission OR a direct teacher/enrollment
-- relationship, with no tenant boundary in Education Core at all. This
-- migration is ADDING a tenant boundary, not fixing a bug in an existing
-- one — see sessions/21-organization-aware-education.md.
--
-- SCHEMA: courses.scope (CourseScope: platform|platform's default,
-- unchanged behavior|organization) + courses.organization_id (nullable
-- FK -> organizations). A CHECK constraint (below) keeps scope and
-- organization_id from ever disagreeing. cohorts/assessments/questions
-- each get their own organization_id, denormalized (copied) from their
-- course's organization_id at creation time by application code
-- (src/lib/courses.ts's createCohort, src/lib/assessments.ts's
-- createAssessment, src/lib/questions.ts's createQuestion) — immutable
-- once set, the exact same convention as lessons.course_id denormalized
-- from modules.course_id (see education_core migration). This follows
-- PLATFORM_ARCHITECTURE.md §15's explicit precedent: "denormalizing
-- organizationId onto the tables that need it directly ... is consistent
-- with this codebase's existing 'denormalize for stability' pattern and
-- keeps policies simple" — every policy below tests one column on its own
-- table (or, for enrollments, one join to cohorts), never a walk up
-- through courses.
--
-- RLS REVIEW — every policy on courses/cohorts/cohort_teachers/
-- enrollments/assessments/questions was individually re-read against this
-- session's Rule ("a Platform Admin's existing courses.manage-based access
-- must be preserved exactly as-is; only the teacher/student relationship
-- branches gain an organization-membership condition") and its Must-Not
-- ("do not silently expand any existing role's reach"). Disposition:
--
--   CHANGED (teacher/student relationship branch gains an organization-
--   membership condition — a no-op for every existing row, since every
--   pre-migration course/cohort/assessment/question has organization_id =
--   NULL and the new condition is always "organization_id IS NULL OR
--   ..."):
--     courses_select      - teacher branch, student branch
--     cohorts_select      - teacher branch, student branch
--     enrollments_select  - teacher branch (rewritten as a second EXISTS
--                           against cohorts; self/cohort-mate branches
--                           untouched, see below)
--     assessments_select  - teacher branch (belt-and-suspenders: this
--                           branch does NOT structurally depend on
--                           cohorts_select the way courses_select's does,
--                           since Postgres re-applies a joined table's own
--                           RLS policy inside another policy's subquery —
--                           this WOULD already cascade correctly from the
--                           cohorts_select fix alone, proven by this
--                           migration's own regression tests, but an
--                           explicit condition on assessments.organization_id
--                           itself is added anyway so this policy's
--                           correctness never silently depends on
--                           cohorts_select's future shape)
--     questions_select    - teacher branch (same reasoning as
--                           assessments_select)
--
--   REVIEWED, NO CHANGE NEEDED (documented reason):
--     courses_write/update/delete       - courses.create/courses.manage
--       only, already global-admin-only pre-migration (no TEACHER/STUDENT
--       branch exists to restrict); Platform Admin's reach here is the
--       exact thing this session must NOT touch.
--     cohorts_write/update/delete       - courses.manage only, same
--       reasoning as courses_write.
--     cohort_teachers_select            - self-row
--       (teacher_user_id = app.user_id) and own-cohort-mate
--       (app_current_user_enrolled_cohort_ids()) branches disclose only
--       "you are assigned to cohort X" / "you are enrolled in cohort X" —
--       never another organization's data, since cohort_id is already a
--       cohort the caller has a legitimate row in. No new condition needed.
--     cohort_teachers_write/delete      - courses.manage only; the
--       org-membership integrity check for a NEW assignment lives in
--       src/lib/courses.ts's assignTeacherToCohort() (application layer),
--       deliberately not in RLS, so a Platform Admin's write access is not
--       narrowed at all (unchanged, per this session's explicit Rule).
--     enrollments_write/update/delete   - courses.manage only, same
--       reasoning as cohort_teachers_write; enrollStudent()'s own
--       org-membership integrity check is the application-layer gate.
--     enrollments_select's self
--       (student_user_id = app.user_id) and cohort-mate
--       (app_current_user_enrolled_cohort_ids()) branches               -
--       same "your own relationship, not another org's data" reasoning as
--       cohort_teachers_select.
--     assessments_write/update, questions_write/update                  -
--       same teacher-of-course EXISTS ownership shape as the SELECT
--       policies, but by the time a cohort_teachers row exists at all for
--       an organization-scoped course, assignTeacherToCohort() has
--       already required that teacher to be an active member of that
--       organization — the condition these SELECT changes add would
--       always evaluate true here, so adding it would be a pure no-op.
--       Left alone to keep this migration's actual behavior change
--       auditable to the SELECT policies list above.
--     assessment_questions_select/question_options_select/
--     question_topics_select/question_options_write/update/delete/
--     question_topics_write/delete                                      -
--       cascade automatically: each is "does the parent question/
--       assessment row exist" (or an ownership walk through the same
--       cohort_teachers/cohorts join), and Postgres re-applies
--       questions_select/assessments_select's OWN (now org-aware) policy
--       to that parent-row lookup. Verified by this migration's regression
--       tests, not merely assumed.
--     modules_select/lessons_select/lesson_versions_select/
--     resources_select (education_core migration) and every other
--     Education Core policy that walks ownership through
--     "cohort_teachers ct JOIN cohorts c"                                -
--       same cascade reasoning: the join to "cohorts" inside their own
--       EXISTS subquery is re-checked against cohorts_select's (now
--       org-aware) policy by Postgres itself. Module/Lesson/Resource are
--       explicitly NOT part of this session's Owns list and get no
--       organization_id column of their own — left untouched, verified via
--       regression test rather than assumed.
--
-- No new SECURITY DEFINER helper function is needed here (contrast with
-- the organization_core/messaging_cohort_visibility migrations): every
-- condition below tests a plain column against the app.organization_ids
-- session variable, never a self-referential subquery into
-- organization_memberships, so there is no recursion risk to route around.

-- CreateEnum
CREATE TYPE "CourseScope" AS ENUM ('platform', 'organization');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN "scope" "CourseScope" NOT NULL DEFAULT 'platform';
ALTER TABLE "courses" ADD COLUMN "organization_id" UUID;

-- AlterTable
ALTER TABLE "cohorts" ADD COLUMN "organization_id" UUID;

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN "organization_id" UUID;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN "organization_id" UUID;

-- CreateIndex
CREATE INDEX "courses_organization_id_idx" ON "courses"("organization_id");
CREATE INDEX "cohorts_organization_id_idx" ON "cohorts"("organization_id");
CREATE INDEX "assessments_organization_id_idx" ON "assessments"("organization_id");
CREATE INDEX "questions_organization_id_idx" ON "questions"("organization_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "questions" ADD CONSTRAINT "questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- courses.scope and courses.organization_id must never disagree: a
-- 'platform' course has no organization, an 'organization' course always
-- has one. Every pre-existing row satisfies this trivially (scope
-- defaults to 'platform', organization_id defaults to NULL).
ALTER TABLE "courses" ADD CONSTRAINT "courses_scope_organization_id_check" CHECK (
  ("scope" = 'platform' AND "organization_id" IS NULL)
  OR ("scope" = 'organization' AND "organization_id" IS NOT NULL)
);

-- Row-Level Security updates ------------------------------------------

-- courses_select: teacher branch and student branch each gain
-- "organization_id IS NULL OR organization_id IN app.organization_ids".
-- The courses.manage/courses.create global bypass is UNTOUCHED (Platform
-- Admin's reach preserved exactly, per this session's explicit Rule).
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

-- cohorts_select: same shape, using cohorts' own organization_id.
DROP POLICY "cohorts_select" ON "cohorts";
CREATE POLICY cohorts_select ON "cohorts" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    EXISTS (
      SELECT 1 FROM cohort_teachers ct WHERE ct.cohort_id = "cohorts"."id"
        AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    AND (
      "cohorts"."organization_id" IS NULL
      OR "cohorts"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
  OR (
    EXISTS (
      SELECT 1 FROM enrollments e WHERE e.cohort_id = "cohorts"."id"
        AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    AND (
      "cohorts"."organization_id" IS NULL
      OR "cohorts"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
);

-- enrollments_select: the teacher branch's own EXISTS(cohort_teachers) is
-- left byte-for-byte unchanged. The organization check needs cohorts'
-- organization_id (enrollments has none of its own — Enrollment was
-- deliberately not in this session's denormalization list) but a direct
-- `EXISTS (SELECT ... FROM cohorts ...)` here creates a genuine NEW mutual
-- recursion with cohorts_select's own student branch (which queries
-- enrollments) — confirmed live ("infinite recursion detected in policy
-- for relation enrollments") while authoring this migration, the exact
-- failure class the organization_core/messaging_cohort_visibility
-- migrations already document. app_cohort_organization_id(), a SECURITY
-- DEFINER function (same convention as those migrations'
-- app_current_user_admin_organization_ids()/
-- app_current_user_enrolled_cohort_ids()), runs as the table owner
-- (bypasses RLS, opaque to the RLS rewriter) so this lookup never
-- re-triggers cohorts_select. Self (student_user_id = app.user_id) and
-- cohort-mate (app_current_user_enrolled_cohort_ids()) branches are
-- untouched — see this migration's header comment.
CREATE FUNCTION app_cohort_organization_id(p_cohort_id UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM cohorts WHERE id = p_cohort_id
$$;

DROP POLICY "enrollments_select" ON "enrollments";
CREATE POLICY "enrollments_select" ON "enrollments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    EXISTS (
      SELECT 1 FROM cohort_teachers ct WHERE ct.cohort_id = "enrollments"."cohort_id"
        AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    AND (
      app_cohort_organization_id("enrollments"."cohort_id") IS NULL
      OR app_cohort_organization_id("enrollments"."cohort_id")::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
  OR "enrollments"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "enrollments"."cohort_id" IN (SELECT app_current_user_enrolled_cohort_ids())
);

-- assessments_select: belt-and-suspenders explicit condition on
-- assessments.organization_id directly (see header comment — this would
-- already cascade correctly from the cohorts_select fix above, but is made
-- explicit so this policy's correctness never silently depends on
-- cohorts_select's future shape). Assignment-based student branch is
-- likewise guarded: an assignment's cohort_id already implies a cohort,
-- and an org-scoped assessment is always assigned via an org-scoped
-- cohort in practice, but the check is written against the assessment
-- row's own organization_id for the same "don't depend on a different
-- table's policy" reasoning.
DROP POLICY "assessments_select" ON "assessments";
CREATE POLICY assessments_select ON "assessments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "assessments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    AND (
      "assessments"."organization_id" IS NULL
      OR "assessments"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
  OR (
    "assessments"."status" = 'published'
    AND EXISTS (
      SELECT 1 FROM assessment_assignments aa
      WHERE aa.assessment_id = "assessments"."id"
      AND (
        aa.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
        OR (
          aa.cohort_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM enrollments e WHERE e.cohort_id = aa.cohort_id
            AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
            AND e.status IN ('active', 'completed')
          )
        )
      )
    )
    AND (
      "assessments"."organization_id" IS NULL
      OR "assessments"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
);

-- questions_select: same belt-and-suspenders reasoning as
-- assessments_select. No student branch exists here (unchanged — see the
-- assessment_core migration's design note on why the bank has none).
DROP POLICY "questions_select" ON "questions";
CREATE POLICY questions_select ON "questions" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "questions"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
    AND (
      "questions"."organization_id" IS NULL
      OR "questions"."organization_id"::text = ANY (
        SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
      )
    )
  )
);
