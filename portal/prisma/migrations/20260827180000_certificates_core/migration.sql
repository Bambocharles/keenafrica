-- Session 14 (Certificates). See sessions/14-certificates.md.
--
-- Certificate is a permanent, append-mostly historical record — a student
-- either earned it or didn't, and once issued the record must stay stable
-- even if the underlying course is later renamed/re-authored (acceptance
-- criterion: "historical certificate record remains stable even if course
-- content changes"). Fields prefixed *_snapshot are copied at issuance time
-- and never re-derived, the same pattern assessment_versions uses for
-- title/instructions/questions.
--
-- Eligibility is owned entirely by Progress (Session 08): the ONLY signal
-- this table's write path (src/lib/certificates.ts's
-- issueCertificateIfEligible) ever checks is enrollments.status = 'completed'
-- — the exact column recalculateCourseProgress() computes and writes. This
-- migration adds no new way to derive completion; it only records that a
-- completion, already decided by Progress, was certified.
CREATE TYPE "CertificateStatus" AS ENUM ('active', 'revoked');

CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "certificate_number" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'active',
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "student_name_snapshot" TEXT NOT NULL,
    "course_title_snapshot" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_reason" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_number_key" ON "certificates"("certificate_number");

-- One certificate per student per course, ever — the idempotency backstop
-- issueCertificateIfEligible() relies on (a duplicate LessonCompleted-
-- triggered re-check, or a genuine race between the explicit post-
-- markLessonComplete() call and this module's own event-listener safety
-- net, both no-op into the same row rather than creating a second one).
CREATE UNIQUE INDEX "certificates_student_user_id_course_id_key" ON "certificates"("student_user_id", "course_id");

-- CreateIndex
CREATE INDEX "certificates_student_user_id_idx" ON "certificates"("student_user_id");

-- CreateIndex
CREATE INDEX "certificates_course_id_idx" ON "certificates"("course_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- certificates_select: super_admin, certificates.manage holders (ADMIN, via
-- ALL_PERMISSION_KEYS), the student themself, or a teacher of the course
-- (cohort_teachers) — this is the "authorized staff can verify it" +
-- "student can view certificate" acceptance criteria enforced at the DB
-- level, not just in application code.
--
-- certificates_write/update: super_admin OR certificates.manage ONLY — no
-- STUDENT or TEACHER role holds certificates.manage (see
-- DEFAULT_ROLE_PERMISSIONS in src/lib/authz.ts), so a plain student or
-- teacher actor cannot INSERT or UPDATE a certificates row through any
-- code path, crafted request included, regardless of what the application
-- layer does or doesn't check — this is the "cannot be forged through
-- client-side manipulation" acceptance criterion's actual backstop.
-- issueCertificateIfEligible() only ever writes under a narrow synthesized
-- context holding exactly this one permission (systemCertificateCtx, same
-- "internal system context" shape as progress.ts's systemProgressCtx()),
-- never under a real actor's own permission set.
--
-- No DELETE policy at all, for any role including super_admin — an issued
-- certificate is permanent history (same append-only spirit as
-- lesson_progress/audit_events/assessment_versions); revocation is a status
-- flip via certificates_update, never a row removal.
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY certificates_select ON "certificates" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
  OR "certificates"."student_user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM cohort_teachers ct JOIN cohorts c ON c.id = ct.cohort_id
    WHERE c.course_id = "certificates"."course_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY certificates_write ON "certificates" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
);

-- Application code (revokeCertificate()) only ever writes status/revoked_at/
-- revoked_by/revoked_reason — RLS is row-level, not column-level, so this
-- is documented as the same known limitation already called out for
-- users_update/suspendUser() (Session 02) and assets_update (Session 13):
-- a certificates.manage holder is DB-permitted to update any column on a
-- row it can already reach, not just the revocation fields.
CREATE POLICY certificates_update ON "certificates" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
);
