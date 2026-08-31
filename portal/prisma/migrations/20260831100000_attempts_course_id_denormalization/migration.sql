-- Session 31 (Assessments P0 root cause, part 2) — attempts_select's
-- teacher-ownership branch joined through "assessments" to resolve a
-- course (assessments asm JOIN cohorts c ON c.course_id = asm.course_id
-- JOIN cohort_teachers ct ON ct.cohort_id = c.id WHERE asm.id =
-- attempts.assessment_id ...). Postgres applies a referenced table's own
-- RLS policy to any reference inside a policy expression (the same
-- mechanism lesson_versions_select/AssessmentAssignment's own migration
-- comments already document) — so evaluating this branch for even ONE
-- row of "attempts" pulls in assessments_select's ENTIRE policy, which
-- itself pulls in assessment_assignments_select AND cohorts_select again.
-- The resulting expanded plan is enormous (500+ plan nodes even against
-- tiny local fixtures) and its ESTIMATED cost is high enough to trip
-- Postgres's JIT compilation threshold (jit_above_cost/
-- jit_optimize_above_cost, defaults 100000/500000) — captured live
-- against production: a query whose WHERE clause reduces to a compile-
-- time-constant `false` (nothing to execute) still reported
-- "Execution Time: 6712.985 ms", almost entirely
-- "JIT: ... Functions: 2148 ... Total 6696.960 ms" — i.e. 6.7 seconds
-- spent JIT-compiling 2148 functions for a query that, once compiled,
-- runs in under a millisecond. This is a DIFFERENT mechanism from this
-- session's other fix (listAssessmentsForCourse's unfiltered `_count`,
-- which was genuine execution cost from an unbounded scan) — this one is
-- pure compile-time overhead from the RLS policy tree's structural size,
-- independent of how much data actually matches.
--
-- Fix: denormalize course_id onto Attempt (same convention as
-- AssessmentAssignment.courseId — see that model's schema.prisma comment
-- and the assessment_core migration's own header note on why: avoiding a
-- second hop through "assessments" that would otherwise create either a
-- genuine RLS policy cycle, or — as here — just a needlessly large plan).
-- attempts.assessment_id is immutable once an attempt is created (no
-- update path ever touches it — see src/lib/attempts.ts), and
-- assessment.course_id is immutable once an assessment is created (no
-- update path in src/lib/assessments.ts ever touches it either), so
-- course_id denormalized at attempt-creation time can never drift from
-- assessments.course_id.
--
-- ACCESS IS PROVABLY IDENTICAL, not just faster: the teacher-ownership
-- branch's cohorts reference (EXISTS ... JOIN cohorts c ...) is itself
-- subject to cohorts_select's own policy, which ALREADY carries the exact
-- organization-membership condition Session 21 added
-- ("cohorts.organization_id IS NULL OR ... IN app.organization_ids").
-- Since assessments.organization_id and cohorts.organization_id are both
-- always copies of the same course's organization_id (Session 21's own
-- denormalization contract), checking either is equivalent — so removing
-- the "assessments" hop does not change which rows a teacher can see, it
-- only removes a redundant path to the SAME check. Verified by this
-- migration's own regression test (assessment-rls.integration.test.ts),
-- not merely assumed.

-- AlterTable: add the column nullable first, backfill, then require it —
-- safe regardless of whether "attempts" holds rows when this runs.
ALTER TABLE "attempts" ADD COLUMN "course_id" UUID;

UPDATE "attempts" a
SET "course_id" = asm."course_id"
FROM "assessments" asm
WHERE asm."id" = a."assessment_id";

ALTER TABLE "attempts" ALTER COLUMN "course_id" SET NOT NULL;

CREATE INDEX "attempts_course_id_idx" ON "attempts"("course_id");

ALTER TABLE "attempts" ADD CONSTRAINT "attempts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security updates ------------------------------------------

DROP POLICY "attempts_select" ON "attempts";
CREATE POLICY attempts_select ON "attempts" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "attempts"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "attempts"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

DROP POLICY "attempts_update" ON "attempts";
CREATE POLICY attempts_update ON "attempts" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    "attempts"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "attempts"."status" = 'in_progress'
  )
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "attempts"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "attempts"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "attempts"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
