-- Session 39 (Keen Africans — Notifications). NotificationPreference — the
-- "notification preferences" capability Session 10's own brief listed
-- under its Owns section but never built. Generic on NotificationType (not
-- a Keen-Africans-specific table — CLAUDE_BUILD_RULES.md §3's "no parallel
-- notification system" extends to not forking its preferences either), so
-- any future portal's notification types get per-user opt-out for free.
--
-- Deliberately minimal, per this session's own brief ("a minimal on/off
-- per type is enough, don't over-build this"): absence of a row for a
-- (user_id, type) pair means enabled (the existing default behavior for
-- every notification type that predates this table) — this table only
-- ever holds opt-outs (enabled=false rows). See
-- src/lib/notifications.ts's setNotificationPreference()/
-- isNotificationEnabled() for the read/write contract, checked once,
-- centrally, inside createNotification() — no per-listener changes needed
-- for this or any future notification type.
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_user_id_type_key" ON "notification_preferences"("user_id", "type");

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- Unlike "notifications" (system-written, no acting user at write time),
-- this table is written directly by the owning user themselves (a real
-- request context, real app.user_id) via the account settings page — so
-- self-only read/write/update/delete is the correct, narrower shape here,
-- mirroring profiles_write/update's "user_id = app.user_id" self-only
-- policies rather than notifications_write's unconditional one. DELETE is
-- included (unlike "notifications", which has none) because
-- setNotificationPreference() deletes the row entirely when a user
-- re-enables a type, rather than writing an enabled=true row — this table
-- is meant to hold only opt-outs.
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select ON "notification_preferences" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

CREATE POLICY notification_preferences_write ON "notification_preferences" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

CREATE POLICY notification_preferences_update ON "notification_preferences" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

CREATE POLICY notification_preferences_delete ON "notification_preferences" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
