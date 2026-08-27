-- Session 09 (Messaging) — extends Session 13's Asset/File service for
-- message attachments, exactly per that session's own documented contract
-- ("add an AssetEntityType value + a matching case in
-- canAccessAssetAttachment() + a matching RLS branch"). Split into its own
-- migration, after the messaging_core migration, because the 'message'
-- AssetEntityType value it references cannot be used in the same
-- transaction that added it (see that migration's header comment).
--
-- A message carries at most one attachment — asset_attachments' existing
-- @@unique([entityType, entityId]) constraint (Session 13) already enforces
-- that; nothing to change there.

DROP POLICY "asset_attachments_select" ON "asset_attachments";
CREATE POLICY "asset_attachments_select" ON "asset_attachments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND EXISTS (SELECT 1 FROM resources r WHERE r."id" = "asset_attachments"."entity_id")
  )
  OR (
    "asset_attachments"."entity_type" = 'message'
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m."id" = "asset_attachments"."entity_id"
        AND m."conversation_id" IN (SELECT app_current_user_conversation_ids())
    )
  )
);

-- Only the message's own sender may attach an asset to it — always done in
-- the same transaction as the message INSERT itself (src/lib/messaging.ts's
-- sendMessage()), never as a later edit (messages have no update path).
DROP POLICY "asset_attachments_write" ON "asset_attachments";
CREATE POLICY "asset_attachments_write" ON "asset_attachments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM resources r JOIN lessons l ON l.id = r.lesson_id
      JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE r."id" = "asset_attachments"."entity_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
  OR (
    "asset_attachments"."entity_type" = 'message'
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m."id" = "asset_attachments"."entity_id"
        AND m."sender_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- asset_attachments_delete is UNCHANGED (still lesson_resource-only, plus
-- the courses.manage/super_admin bypass) — message attachments are never
-- detached (messages/attachments are permanent, no removal feature), so
-- DELETE stays correctly denied for entity_type = 'message'.
