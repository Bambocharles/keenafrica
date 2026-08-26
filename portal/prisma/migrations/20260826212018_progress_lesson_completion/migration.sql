-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_progress_student_user_id_idx" ON "lesson_progress"("student_user_id");

-- CreateIndex
CREATE INDEX "lesson_progress_course_id_idx" ON "lesson_progress"("course_id");

-- CreateIndex
CREATE INDEX "lesson_progress_lesson_id_idx" ON "lesson_progress"("lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_student_user_id_lesson_id_key" ON "lesson_progress"("student_user_id", "lesson_id");

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- Session 08 (Progress & Adaptive Learning). No new permission keys — the
-- write side is self-scoped exactly like student_notes/bookmarks/attempts
-- (a student may only ever record THEIR OWN lesson completion); the read
-- side extends to a course's teacher (courses.content.write/publish holder
-- via cohort_teachers) and courses.manage/super_admin, the same
-- teacher-of-course shape used throughout assessment_core.
--
-- Append-only, matching lesson_versions/assessment_versions/audit_events:
-- NO UPDATE and NO DELETE policy at all, for ANY role including
-- super_admin — a recorded completion is permanent history. If a student
-- mistakenly marks a lesson complete, that stays a documented known
-- limitation (see docs/PROGRESS.md) rather than a mutable row, consistent
-- with CLAUDE_BUILD_RULES.md #4 ("never casually delete historical
-- records").
ALTER TABLE "lesson_progress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY lesson_progress_select ON "lesson_progress" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "lesson_progress"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "lesson_progress"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY lesson_progress_write ON "lesson_progress" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "lesson_progress"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
