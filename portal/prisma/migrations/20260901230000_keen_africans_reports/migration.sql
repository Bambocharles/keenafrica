-- Session 41 (Admin Moderation, Reporting & Verification Review). See
-- schema.prisma's Report comment for the full design.
--
-- Note: this migration deliberately does NOT touch
-- "user_identities_user_id_fkey" — `prisma migrate diff`'s output proposed
-- dropping/recreating it (RESTRICT/CASCADE vs. the already-applied
-- NO ACTION/NO ACTION) purely because UserIdentity.user has never declared
-- explicit onDelete/onUpdate in schema.prisma; that's pre-existing drift
-- from Session 19, unrelated to this session's scope, so it was stripped
-- from the generated SQL rather than silently applied here — same call
-- the keen_africans_verification migration already made for the identical
-- diff noise.

-- CreateEnum
CREATE TYPE "ReportEntityType" AS ENUM ('article', 'profile');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'reviewed', 'dismissed');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "ReportEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "reporter_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_entity_type_entity_id_idx" ON "reports"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- reports_write (INSERT): unconditional WITH CHECK (true) — same shape as
-- audit_events_write (identity_security_foundation migration). Reporting
-- an article or a profile must work for a genuinely anonymous reader (no
-- app.user_id at all) per sessions/41's own brief ("Do not require the
-- reporter to be logged in"), so there is no actor condition to gate on at
-- the DB layer at all; src/lib/reports.ts's createReport() is the actual
-- abuse boundary (entity-existence check + src/lib/rate-limit.ts's
-- countRecentAuditEvents, dual per-account/per-IP, same mechanism the
-- login limiter and articles.ts's article-creation limiter already use —
-- no new limiter mechanism per this session's explicit rule).
--
-- reports_select / reports_review (UPDATE): articles.manage or
-- super_admin only — reports are reviewed on the same Keen Africans
-- moderation console as article moderation, under the same permission key
-- (this session deliberately does not mint a new permission just for
-- reports; see docs/KEEN_AFRICANS.md). No self-select branch: a reporter
-- (anonymous or not) submits blind and cannot read back the queue, same
-- "write, not read, is the self-service surface" shape audit_events_write
-- already establishes for actors without audit.read.
--
-- No DELETE policy — append-only, same convention as every other
-- moderation-adjacent table in this codebase (articles/certificates/
-- keen_african_verifications).
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_write" ON "reports" FOR INSERT WITH CHECK (true);

CREATE POLICY "reports_select" ON "reports" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
);

CREATE POLICY "reports_review" ON "reports" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
);
