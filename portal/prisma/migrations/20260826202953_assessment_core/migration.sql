-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multiple_choice', 'short_answer');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "AssessmentAssignmentScope" AS ENUM ('cohort', 'student');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('in_progress', 'submitted', 'graded');

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'medium',
    "learning_objective" TEXT NOT NULL DEFAULT '',
    "acceptable_answers" JSONB,
    "created_by" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_topics" (
    "question_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,

    CONSTRAINT "question_topics_pkey" PRIMARY KEY ("question_id","topic_id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "time_limit_minutes" INTEGER,
    "max_attempts" INTEGER,
    "passing_score_percent" INTEGER,
    "created_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "assessment_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("assessment_id","question_id")
);

-- CreateTable
CREATE TABLE "assessment_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "scope" "AssessmentAssignmentScope" NOT NULL,
    "cohort_id" UUID,
    "student_user_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "assessment_version_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "graded_at" TIMESTAMPTZ(6),
    "graded_by" UUID,
    "score_points" INTEGER,
    "max_points" INTEGER,
    "score_percent" DOUBLE PRECISION,
    "passed" BOOLEAN,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "selected_option_ids" JSONB,
    "text_response" TEXT,
    "is_correct" BOOLEAN,
    "awarded_points" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questions_course_id_idx" ON "questions"("course_id");

-- CreateIndex
CREATE INDEX "questions_created_by_idx" ON "questions"("created_by");

-- CreateIndex
CREATE INDEX "question_options_question_id_idx" ON "question_options"("question_id");

-- CreateIndex
CREATE INDEX "question_topics_topic_id_idx" ON "question_topics"("topic_id");

-- CreateIndex
CREATE INDEX "assessments_course_id_idx" ON "assessments"("course_id");

-- CreateIndex
CREATE INDEX "assessment_questions_question_id_idx" ON "assessment_questions"("question_id");

-- CreateIndex
CREATE INDEX "assessment_versions_assessment_id_idx" ON "assessment_versions"("assessment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_versions_assessment_id_version_key" ON "assessment_versions"("assessment_id", "version");

-- CreateIndex
CREATE INDEX "assessment_assignments_assessment_id_idx" ON "assessment_assignments"("assessment_id");

-- CreateIndex
CREATE INDEX "assessment_assignments_course_id_idx" ON "assessment_assignments"("course_id");

-- CreateIndex
CREATE INDEX "assessment_assignments_cohort_id_idx" ON "assessment_assignments"("cohort_id");

-- CreateIndex
CREATE INDEX "assessment_assignments_student_user_id_idx" ON "assessment_assignments"("student_user_id");

-- CreateIndex
CREATE INDEX "attempts_student_user_id_idx" ON "attempts"("student_user_id");

-- CreateIndex
CREATE INDEX "attempts_assessment_id_idx" ON "attempts"("assessment_id");

-- CreateIndex
CREATE INDEX "attempts_assessment_version_id_idx" ON "attempts"("assessment_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_assessment_id_student_user_id_attempt_number_key" ON "attempts"("assessment_id", "student_user_id", "attempt_number");

-- CreateIndex
CREATE INDEX "answers_attempt_id_idx" ON "answers"("attempt_id");

-- CreateIndex
CREATE INDEX "answers_question_id_idx" ON "answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_attempt_id_question_id_key" ON "answers"("attempt_id", "question_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "question_topics" ADD CONSTRAINT "question_topics_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "question_topics" ADD CONSTRAINT "question_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_versions" ADD CONSTRAINT "assessment_versions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_versions" ADD CONSTRAINT "assessment_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assessment_version_id_fkey" FOREIGN KEY ("assessment_version_id") REFERENCES "assessment_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CheckConstraint
-- Exactly one of cohort_id/student_user_id is set, matching `scope` — Prisma
-- has no native XOR constraint, so this is hand-authored (same as the RLS
-- section below).
ALTER TABLE "assessment_assignments" ADD CONSTRAINT "assessment_assignments_scope_check" CHECK (
  ("scope" = 'cohort' AND "cohort_id" IS NOT NULL AND "student_user_id" IS NULL)
  OR ("scope" = 'student' AND "student_user_id" IS NOT NULL AND "cohort_id" IS NULL)
);

-- Row-Level Security
--
-- No new permission keys (see src/lib/authz.ts) — assessment authoring
-- reuses courses.content.write/courses.content.publish exactly like
-- Module/Lesson, ownership-scoped via cohort_teachers (per Session 05's
-- documented contract to this session). See docs/ASSESSMENT.md for the
-- full contract.
--
-- NOTE ON QUALIFICATION: every reference to a policy's own table below is
-- qualified with the table name (e.g. "assessments"."id"), even where a
-- bare column name would be unambiguous in ordinary SQL — CREATE POLICY's
-- expression parser does not apply standard inner-scope-wins resolution
-- inside a correlated EXISTS subquery, and an unqualified reference that
-- also exists on a table joined inside the subquery raises a hard
-- "ambiguous" error at migration time (see the education_core migration's
-- own note; re-confirmed while authoring this one).
--
-- DESIGN NOTE — why the answer key lives in a SELECT-able row: RLS is a
-- coarse, ROW-level backstop (documented limitation since Session 02's
-- handoff), not column-level. `assessment_versions.questions` denormalizes
-- the full question/option/correct-answer tree, and a student who has an
-- Attempt against a version IS permitted to SELECT that row (they need the
-- prompts/options to take the assessment, and the explanations/correct
-- answers to view results afterward). Hiding the answer key from an
-- in-progress attempt, and hiding a short-answer question's ungraded
-- verdict, is therefore an APPLICATION-layer redaction
-- (src/lib/attempts.ts's sanitizeQuestionsForAttempt()), not a DB policy —
-- exactly the same "RLS enforces row visibility, application code enforces
-- field-level sensitivity" split already established for `users`'
-- suspend-only columns. The `questions`/`question_options` bank tables
-- themselves (where the answer key ALSO lives, in normalized form) have NO
-- student SELECT branch at all — a student can never query those tables
-- directly, only ever read the frozen snapshot through their own attempt.
--
-- Ownership subquery shapes (repeated below, same idiom as education_core):
--   teacher-of-course via questions.course_id:
--     EXISTS (SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
--       WHERE c.course_id = <course_id column> AND ct.teacher_user_id = app.user_id)
--   teacher-of-course via assessment_id (one hop further, through assessments):
--     EXISTS (SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
--       JOIN cohort_teachers ct ON ct.cohort_id = c.id
--       WHERE asm.id = <assessment_id column> AND ct.teacher_user_id = app.user_id)

ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "answers" ENABLE ROW LEVEL SECURITY;

-- questions ----------------------------------------------------------------
-- Bank content. Teacher (of the course, via cohort_teachers)/courses.manage/
-- super_admin only — deliberately NO student branch (see design note above).
-- No DELETE policy at all: a bank question is archived (archived_at), never
-- hard-deleted, so it can never disappear out from under a past attempt's
-- FK or a topic-analysis report.
CREATE POLICY questions_select ON "questions" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "questions"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY questions_write ON "questions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "questions"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY questions_update ON "questions" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "questions"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "questions"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- question_options -----------------------------------------------------
-- SELECT cascades through questions' own RLS (same reasoning as
-- resources_select cascading through lessons) — since questions_select has
-- no student branch, options (which carry is_correct — the answer key) are
-- consequently unreachable by a student through this table too.
CREATE POLICY question_options_select ON "question_options" FOR SELECT USING (
  EXISTS (SELECT 1 FROM questions q WHERE q.id = "question_options"."question_id")
);
CREATE POLICY question_options_write ON "question_options" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM questions q JOIN cohorts c ON c.course_id = q.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE q.id = "question_options"."question_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY question_options_update ON "question_options" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM questions q JOIN cohorts c ON c.course_id = q.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE q.id = "question_options"."question_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM questions q JOIN cohorts c ON c.course_id = q.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE q.id = "question_options"."question_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY question_options_delete ON "question_options" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM questions q JOIN cohorts c ON c.course_id = q.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE q.id = "question_options"."question_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- question_topics ----------------------------------------------------------
-- Tag join table, same shape as lesson_topics.
CREATE POLICY question_topics_select ON "question_topics" FOR SELECT USING (
  EXISTS (SELECT 1 FROM questions q WHERE q.id = "question_topics"."question_id")
);
CREATE POLICY question_topics_write ON "question_topics" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM questions q JOIN cohorts c ON c.course_id = q.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE q.id = "question_topics"."question_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY question_topics_delete ON "question_topics" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM questions q JOIN cohorts c ON c.course_id = q.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE q.id = "question_topics"."question_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- assessments ----------------------------------------------------------
-- Same shape as courses/modules/lessons: admin/teacher-of-course see
-- everything (incl. draft); a student sees a PUBLISHED assessment only once
-- it's actually assigned to them (directly, or via a cohort they're
-- actively/completed-enrolled in). No DELETE policy — archive, don't delete.
CREATE POLICY assessments_select ON "assessments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "assessments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
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
  )
);
CREATE POLICY assessments_write ON "assessments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "assessments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY assessments_update ON "assessments" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    (
      coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
      OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    )
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "assessments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    (
      coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
      OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    )
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "assessments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- assessment_questions -------------------------------------------------
-- Live/mutable bank<->assessment link. SELECT cascades through assessments'
-- own RLS (same reasoning as lesson_topics); write/update/delete require
-- courses.content.write + course ownership.
CREATE POLICY assessment_questions_select ON "assessment_questions" FOR SELECT USING (
  EXISTS (SELECT 1 FROM assessments asm WHERE asm.id = "assessment_questions"."assessment_id")
);
CREATE POLICY assessment_questions_write ON "assessment_questions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "assessment_questions"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY assessment_questions_update ON "assessment_questions" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "assessment_questions"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "assessment_questions"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY assessment_questions_delete ON "assessment_questions" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "assessment_questions"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- assessment_versions ----------------------------------------------------
-- Append-only (no UPDATE/DELETE policy at all — exact lesson_versions
-- shape): a published snapshot can never be altered or removed through the
-- app, by any role, including super_admin. SELECT: teacher/admin (own the
-- course), OR the specific student who has an Attempt bound to this exact
-- version (see design note above re: answer-key redaction being an
-- application-layer concern, not a DB one).
CREATE POLICY assessment_versions_select ON "assessment_versions" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
    JOIN cohort_teachers ct ON ct.cohort_id = c.id
    WHERE asm.id = "assessment_versions"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR EXISTS (
    SELECT 1 FROM attempts att WHERE att.assessment_version_id = "assessment_versions"."id"
    AND att.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY assessment_versions_write ON "assessment_versions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    AND EXISTS (
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "assessment_versions"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- assessment_assignments -------------------------------------------------
-- Gated by courses.content.publish (assigning is part of the publish->assign
-- step, same as this session's contract to Teacher/Student docs). A
-- student may SELECT their own assignment rows (direct, or via a cohort
-- they're actively enrolled in) so listMyAssignedAssessments()/startAttempt()
-- can read "am I assigned this?" under their own actor context rather than
-- an app-layer superuser bypass.
--
-- IMPORTANT — why the teacher-ownership branch below uses the denormalized
-- course_id column instead of joining through "assessments": Postgres
-- applies a referenced table's OWN RLS policies to any table access inside
-- a policy expression (that's exactly what makes lesson_versions_select's
-- "cascades through lessons' RLS" trick work). assessments_select's student
-- branch already reads assessment_assignments; if assessment_assignments'
-- own policies read back from "assessments" to resolve a course id, the two
-- policies reference each other and Postgres reports "infinite recursion
-- detected in policy for relation assessments" — reproduced for real while
-- authoring this migration, against the actual portal_rls_test role, not a
-- theoretical concern. Reading course_id directly off this row (see
-- schema.prisma's AssessmentAssignment.courseId comment) breaks the cycle.
CREATE POLICY assessment_assignments_select ON "assessment_assignments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "assessment_assignments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR "assessment_assignments"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR (
    "assessment_assignments"."cohort_id" IS NOT NULL AND EXISTS (
      SELECT 1 FROM enrollments e WHERE e.cohort_id = "assessment_assignments"."cohort_id"
      AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND e.status IN ('active', 'completed')
    )
  )
);
CREATE POLICY assessment_assignments_write ON "assessment_assignments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "assessment_assignments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY assessment_assignments_delete ON "assessment_assignments" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "assessment_assignments"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- attempts ---------------------------------------------------------------
-- Insert/base-select: self (the attempting student) or admin. Teachers see
-- every attempt on their own course's assessments (for grading/results).
-- No DELETE policy at all — a submitted/graded attempt is permanent
-- history, exactly the "never permanently overwrite historical attempts"
-- requirement. UPDATE is split: the student may update their OWN attempt
-- only while still in_progress (submitting); the teacher may update a
-- SUBMITTED attempt while grading it (courses.content.write — grading is
-- ordinary authoring-adjacent teacher work, not a publish action).
CREATE POLICY attempts_select ON "attempts" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "attempts"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
    JOIN cohort_teachers ct ON ct.cohort_id = c.id
    WHERE asm.id = "attempts"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY attempts_write ON "attempts" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "attempts"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
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
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "attempts"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "attempts"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM assessments asm JOIN cohorts c ON c.course_id = asm.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE asm.id = "attempts"."assessment_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- answers ------------------------------------------------------------------
-- Same self-vs-teacher split as attempts, joined through the parent attempt.
-- No DELETE policy — an answer, once submitted, is permanent history.
CREATE POLICY answers_select ON "answers" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM attempts att WHERE att.id = "answers"."attempt_id"
    AND att.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR EXISTS (
    SELECT 1 FROM attempts att JOIN assessments asm ON asm.id = att.assessment_id
    JOIN cohorts c ON c.course_id = asm.course_id JOIN cohort_teachers ct ON ct.cohort_id = c.id
    WHERE att.id = "answers"."attempt_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY answers_write ON "answers" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR EXISTS (
    SELECT 1 FROM attempts att WHERE att.id = "answers"."attempt_id"
    AND att.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND att.status = 'in_progress'
  )
);
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
      SELECT 1 FROM attempts att JOIN assessments asm ON asm.id = att.assessment_id
      JOIN cohorts c ON c.course_id = asm.course_id JOIN cohort_teachers ct ON ct.cohort_id = c.id
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
      SELECT 1 FROM attempts att JOIN assessments asm ON asm.id = att.assessment_id
      JOIN cohorts c ON c.course_id = asm.course_id JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE att.id = "answers"."attempt_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
