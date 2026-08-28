-- Session 26 (QA Teacher) — found live: sending ANY message, by ANYONE, has
-- been completely broken under real RLS enforcement since messaging_core
-- (Session 09) shipped. src/lib/messaging.ts's startConversation() does
-- `tx.conversation.create({ data: { ..., createdBy: actor.id } })` before
-- any conversation_participants row exists for that conversation. Prisma's
-- .create() always performs `INSERT ... RETURNING *` under the hood, and
-- Postgres RLS governs a RETURNING clause by the table's SELECT policy, not
-- just its INSERT/WITH CHECK policy (a well-known RLS interaction, distinct
-- from ordinary INSERT-then-SELECT). conversations_select was
-- `is_super_admin OR id IN (SELECT app_current_user_conversation_ids())` —
-- and app_current_user_conversation_ids() reads conversation_participants,
-- which has no row for this conversation yet at INSERT time. Postgres
-- reports this identically to an INSERT/WITH CHECK failure ("new row
-- violates row-level security policy"), which is why this was never
-- distinguished from a genuine authorization rejection in application logs
-- — reproduced directly via raw SQL: the exact same INSERT succeeds with no
-- RETURNING clause and fails only once RETURNING is added.
--
-- Local dev (superuser DATABASE_URL) always bypasses RLS, so every "real
-- HTTP" verification this session and every one before it that exercised
-- messaging locally never actually exercised this path under RLS — the
-- same masking class as this session's other two findings (courses.ts's
-- SYSTEM_CTX fix, users_select's cohort-relationship branch).
--
-- Fix: a conversation's own creator can always see the row they just
-- created, independent of participant rows existing yet. This is the
-- minimal fix at the actual point of failure — createMany() for
-- conversation_participants right after does NOT implicitly RETURNING (no
-- change needed there), and by the time messages.create() runs, the
-- actor's own participant row already exists in the same transaction, so
-- app_current_user_conversation_ids() already covers it correctly.
DROP POLICY "conversations_select" ON "conversations";
CREATE POLICY "conversations_select" ON "conversations" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "conversations"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "conversations"."id" IN (SELECT app_current_user_conversation_ids())
);
