-- Session 10 (Notifications). The canonical, platform-wide notification
-- center — see schema.prisma's "Notifications (Session 10)" section header
-- and docs/NOTIFICATIONS.md for the full contract (event-to-notification
-- mapping, delivery channel abstraction, duplicate-delivery protection).

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('message_received', 'assessment_assigned', 'assessment_submitted', 'assessment_graded', 'course_published', 'student_enrolled', 'certificate_issued', 'account_suspended', 'role_changed', 'project_milestone_updated');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "notifications"("recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_idx" ON "notifications"("recipient_id", "read_at");

-- Duplicate-delivery protection: src/lib/notifications.ts's createNotification()
-- derives dedupeKey from the driving domain event's own natural identity
-- (e.g. a specific messageId, a specific attempt's gradedAt) and upserts
-- against this constraint, so the SAME real-world occurrence delivered
-- twice (a re-registered listener, an idempotent caller, or a future
-- durable-queue redelivery) never creates a second row or triggers a
-- second channel send for the same recipient.
CREATE UNIQUE INDEX "notifications_recipient_id_dedupe_key_key" ON "notifications"("recipient_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- notifications is written exclusively by src/lib/notifications.ts's
-- internal event listeners, which run with no acting user/request context
-- (a domain event has no "current session" — see src/lib/events.ts). There
-- is therefore no legitimate app.user_id to require on INSERT, the same
-- situation audit_events_write already solved: an unconditional
-- `WITH CHECK (true)` INSERT policy, with the real gate being that
-- createNotification() is never exposed as a caller-facing action — only
-- this module's own onDomainEvent handlers call it. See
-- docs/NOTIFICATIONS.md's "Why notifications_write is unconditional" note.
--
-- SELECT/UPDATE are the actual user-facing authorization boundary, and are
-- deliberately narrower than every other table in this schema: self (the
-- recipient) or super_admin ONLY — no permission-based bypass for any role
-- (unlike audit_events' audit.read, sessions' sessions.read, etc.). This is
-- the literal acceptance criterion "Must NOT expose another user's
-- notifications" — there is no legitimate product reason for an ADMIN or
-- TEACHER to browse a different user's notification inbox, so no such
-- capability exists at either the application or RLS layer.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON "notifications" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notifications"."recipient_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

CREATE POLICY notifications_write ON "notifications" FOR INSERT WITH CHECK (true);

-- UPDATE is restricted to the recipient marking their own notification(s)
-- read (application code only ever writes read_at through it — see
-- markNotificationRead()/markAllNotificationsRead()). No DELETE policy at
-- all, for any role — same append-oriented spirit as audit_events/
-- lesson_versions/assessment_versions, just with one mutable field.
CREATE POLICY notifications_update ON "notifications" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notifications"."recipient_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notifications"."recipient_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
