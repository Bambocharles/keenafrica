-- CreateEnum
CREATE TYPE "NoteTargetType" AS ENUM ('course', 'module', 'lesson', 'resource', 'question');

-- CreateEnum
CREATE TYPE "BookmarkTargetType" AS ENUM ('lesson', 'resource');

-- CreateTable
CREATE TABLE "student_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "target_type" "NoteTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "target_type" "BookmarkTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_notes_student_user_id_idx" ON "student_notes"("student_user_id");

-- CreateIndex
CREATE INDEX "student_notes_course_id_idx" ON "student_notes"("course_id");

-- CreateIndex
CREATE INDEX "student_notes_target_type_target_id_idx" ON "student_notes"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "bookmarks_student_user_id_idx" ON "bookmarks"("student_user_id");

-- CreateIndex
CREATE INDEX "bookmarks_course_id_idx" ON "bookmarks"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_student_user_id_target_type_target_id_key" ON "bookmarks"("student_user_id", "target_type", "target_id");

-- AddForeignKey
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- Both tables are fully private, self-owned data — no permission key gates
-- them (matching listMyEnrollments()'s "no permission required beyond
-- self-scoping" shape in src/lib/courses.ts). super_admin is the only
-- bypass, kept solely for symmetry with every other table's policy shape
-- in this schema; no admin UI reads/writes these tables. Nobody else —
-- not a course's teacher, not another student — can see a student's notes
-- or bookmarks: notes/bookmarks are productivity data, not part of the
-- Education Core content model.
ALTER TABLE "student_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookmarks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_notes_select ON "student_notes" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "student_notes"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY student_notes_write ON "student_notes" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "student_notes"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY student_notes_update ON "student_notes" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "student_notes"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "student_notes"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY student_notes_delete ON "student_notes" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "student_notes"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

-- bookmarks: no UPDATE policy — a bookmark is only ever added or removed,
-- never edited in place, so UPDATE is disallowed entirely (same "just
-- don't grant the policy" shape lesson_versions uses for append-only).
CREATE POLICY bookmarks_select ON "bookmarks" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "bookmarks"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY bookmarks_write ON "bookmarks" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "bookmarks"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY bookmarks_delete ON "bookmarks" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "bookmarks"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
