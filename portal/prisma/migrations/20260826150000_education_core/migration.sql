-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'completed', 'withdrawn');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('link', 'document', 'video');

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CourseStatus" NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CohortStatus" NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_teachers" (
    "cohort_id" UUID NOT NULL,
    "teacher_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_teachers_pkey" PRIMARY KEY ("cohort_id","teacher_user_id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- course_id is denormalized from modules.course_id (see schema.prisma
-- comment) so every RLS policy below is a single join, not a three-table
-- walk through modules on every lesson read/write.
CREATE TABLE "lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL DEFAULT 'link',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_topics" (
    "lesson_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,

    CONSTRAINT "lesson_topics_pkey" PRIMARY KEY ("lesson_id","topic_id")
);

-- CreateIndex
CREATE INDEX "courses_created_by_idx" ON "courses"("created_by");

-- CreateIndex
CREATE INDEX "cohorts_course_id_idx" ON "cohorts"("course_id");

-- CreateIndex
CREATE INDEX "cohort_teachers_teacher_user_id_idx" ON "cohort_teachers"("teacher_user_id");

-- CreateIndex
CREATE INDEX "enrollments_student_user_id_idx" ON "enrollments"("student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_cohort_id_student_user_id_key" ON "enrollments"("cohort_id", "student_user_id");

-- CreateIndex
CREATE INDEX "modules_course_id_idx" ON "modules"("course_id");

-- CreateIndex
CREATE INDEX "lessons_module_id_idx" ON "lessons"("module_id");

-- CreateIndex
CREATE INDEX "lessons_course_id_idx" ON "lessons"("course_id");

-- CreateIndex
CREATE INDEX "lesson_versions_lesson_id_idx" ON "lesson_versions"("lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_versions_lesson_id_version_key" ON "lesson_versions"("lesson_id", "version");

-- CreateIndex
CREATE INDEX "resources_lesson_id_idx" ON "resources"("lesson_id");

-- CreateIndex
CREATE INDEX "topics_parent_id_idx" ON "topics"("parent_id");

-- CreateIndex
CREATE INDEX "lesson_topics_topic_id_idx" ON "lesson_topics"("topic_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_teachers" ADD CONSTRAINT "cohort_teachers_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_teachers" ADD CONSTRAINT "cohort_teachers_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "topics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_topics" ADD CONSTRAINT "lesson_topics_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lesson_topics" ADD CONSTRAINT "lesson_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- New permission keys (see src/lib/authz.ts): courses.create, courses.manage,
-- courses.publish, courses.content.write, courses.content.publish,
-- topics.manage. courses.manage is the admin "full course/cohort/enrollment
-- management" key; courses.publish gates the COURSE-level draft->published->
-- archived lifecycle (admin); courses.content.write/courses.content.publish
-- gate Module/Lesson/Resource/topic-tag authoring and publishing and are
-- held by TEACHER by default, but are always ownership-scoped: a TEACHER
-- holder must ALSO be a cohort_teachers row for a cohort of that course.
-- super_admin and courses.manage holders bypass the ownership scoping
-- entirely (same shape as every other "admin OR self/owner" policy in this
-- schema).
--
-- Ownership subquery shape, repeated on every content table below:
--   EXISTS (
--     SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
--     WHERE c.course_id = <course_id column> AND ct.teacher_user_id = app.user_id
--   )
-- Student visibility shape (published content only, active/completed
-- enrollment only):
--   "status" = 'published' AND EXISTS (
--     SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
--     WHERE c.course_id = <course_id column> AND e.student_user_id = app.user_id
--       AND e.status IN ('active', 'completed')
--   )
-- A draft module/lesson never satisfies this — enforcing "draft content is
-- invisible to students" at the database level, not just in application code.

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cohorts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cohort_teachers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_topics" ENABLE ROW LEVEL SECURITY;

-- courses --------------------------------------------------------------
-- NOTE ON QUALIFICATION: every reference to this policy's own table below
-- is qualified with the table name (e.g. "courses"."id"), even where a
-- bare column name would be unambiguous in ordinary SQL. CREATE POLICY's
-- expression parser does not apply standard inner-scope-wins resolution
-- inside a correlated EXISTS subquery — a bare column reference that also
-- exists on a table joined inside the subquery raises a hard "ambiguous"
-- error at migration time instead of silently binding to the wrong table.
-- Verified against this repo's Postgres 16 while authoring this migration.
CREATE POLICY courses_select ON "courses" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.create'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "courses"."id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR (
    "courses"."status" IN ('published', 'archived')
    AND EXISTS (
      SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
      WHERE c.course_id = "courses"."id" AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND e.status IN ('active', 'completed')
    )
  )
);
CREATE POLICY courses_write ON "courses" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.create'
);
CREATE POLICY courses_update ON "courses" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.publish'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.publish'
);
CREATE POLICY courses_delete ON "courses" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);

-- cohorts ----------------------------------------------------------------
CREATE POLICY cohorts_select ON "cohorts" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct WHERE ct.cohort_id = "cohorts"."id"
      AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR EXISTS (
    SELECT 1 FROM enrollments e WHERE e.cohort_id = "cohorts"."id"
      AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
CREATE POLICY cohorts_write ON "cohorts" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);
CREATE POLICY cohorts_update ON "cohorts" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);
CREATE POLICY cohorts_delete ON "cohorts" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);

-- cohort_teachers ----------------------------------------------------------
-- Self-read (teacher_user_id = app.user_id) is what lets a TEACHER holder's
-- own ownership checks (src/lib/courses.ts's isCourseTeacher()) work at all
-- without a broader permission — mirrors sessions_select's self clause.
CREATE POLICY cohort_teachers_select ON "cohort_teachers" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR "cohort_teachers"."teacher_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY cohort_teachers_write ON "cohort_teachers" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);
CREATE POLICY cohort_teachers_delete ON "cohort_teachers" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);

-- enrollments ----------------------------------------------------------
CREATE POLICY enrollments_select ON "enrollments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct WHERE ct.cohort_id = "enrollments"."cohort_id"
      AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR "enrollments"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY enrollments_write ON "enrollments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);
CREATE POLICY enrollments_update ON "enrollments" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);
CREATE POLICY enrollments_delete ON "enrollments" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);

-- modules ----------------------------------------------------------------
CREATE POLICY modules_select ON "modules" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "modules"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR (
    "modules"."status" = 'published'
    AND EXISTS (
      SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
      WHERE c.course_id = "modules"."course_id" AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND e.status IN ('active', 'completed')
    )
  )
);
CREATE POLICY modules_write ON "modules" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "modules"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY modules_update ON "modules" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    (
      coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
      OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    )
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "modules"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
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
      WHERE c.course_id = "modules"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY modules_delete ON "modules" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);

-- lessons ------------------------------------------------------------------
CREATE POLICY lessons_select ON "lessons" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "lessons"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  OR (
    "lessons"."status" = 'published'
    AND EXISTS (
      SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
      WHERE c.course_id = "lessons"."course_id" AND e.student_user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND e.status IN ('active', 'completed')
    )
  )
);
CREATE POLICY lessons_write ON "lessons" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "lessons"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY lessons_update ON "lessons" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    (
      coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
      OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    )
    AND EXISTS (
      SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
      WHERE c.course_id = "lessons"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
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
      WHERE c.course_id = "lessons"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY lessons_delete ON "lessons" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
);

-- lesson_versions ------------------------------------------------------
-- Append-only, like audit_events: no UPDATE/DELETE policy at all, so a
-- published snapshot can never be altered or removed through the app, by
-- any role. SELECT/INSERT cascade through the *lessons* table's own RLS
-- (a plain subquery against "lessons" is itself subject to lessons' SELECT
-- policy, so this stays in sync with lessons_select automatically instead
-- of duplicating its branches).
CREATE POLICY lesson_versions_select ON "lesson_versions" FOR SELECT USING (
  EXISTS (SELECT 1 FROM lessons l WHERE l.id = "lesson_versions"."lesson_id")
);
CREATE POLICY lesson_versions_write ON "lesson_versions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.publish'
    AND EXISTS (
      SELECT 1 FROM lessons l JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE l.id = "lesson_versions"."lesson_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- resources ------------------------------------------------------------
CREATE POLICY resources_select ON "resources" FOR SELECT USING (
  EXISTS (SELECT 1 FROM lessons l WHERE l.id = "resources"."lesson_id")
);
CREATE POLICY resources_write ON "resources" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM lessons l JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE l.id = "resources"."lesson_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY resources_delete ON "resources" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM lessons l JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE l.id = "resources"."lesson_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- topics -----------------------------------------------------------------
-- Catalog table, not sensitive (taxonomy names aren't secrets) — public
-- read, same pattern as "roles"/"permissions"/"feature_flags".
CREATE POLICY topics_select ON "topics" FOR SELECT USING (true);
CREATE POLICY topics_write ON "topics" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'topics.manage'
);
CREATE POLICY topics_update ON "topics" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'topics.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'topics.manage'
);
CREATE POLICY topics_delete ON "topics" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'topics.manage'
);

-- lesson_topics ----------------------------------------------------------
-- Tag join table. SELECT cascades through lessons' own RLS (same reasoning
-- as lesson_versions_select) so a draft lesson's tags stay hidden from
-- students exactly when the lesson itself would be.
CREATE POLICY lesson_topics_select ON "lesson_topics" FOR SELECT USING (
  EXISTS (SELECT 1 FROM lessons l WHERE l.id = "lesson_topics"."lesson_id")
);
CREATE POLICY lesson_topics_write ON "lesson_topics" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM lessons l JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE l.id = "lesson_topics"."lesson_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY lesson_topics_delete ON "lesson_topics" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM lessons l JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE l.id = "lesson_topics"."lesson_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
