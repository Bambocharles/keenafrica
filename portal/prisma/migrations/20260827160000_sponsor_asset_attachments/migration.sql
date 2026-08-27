-- Session 11 (Sponsor) — extends Session 13's Asset/File service for
-- sponsor-visible documents, exactly per that session's own documented
-- contract ("add an AssetEntityType value + a matching case in
-- canAccessAssetAttachment() + a matching RLS branch") and the assets_files
-- migration's own forward-looking comment naming 'sponsor_document' as a
-- future entity_type. Split into its own migration, after sponsor_core,
-- because the 'sponsor_document' AssetEntityType value it references
-- cannot be used in the same transaction that added it (see that
-- migration's header comment).
--
-- The select branch cascades through project_documents' own RLS policy
-- (sponsor_core migration) exactly like the lesson_resource branch
-- cascades through resources_select — no duplicated visibility logic.
-- Only a project_documents row created by an already-authorized
-- sponsor.manage holder gets attached (src/lib/sponsor-documents.ts), so
-- write/delete need no separate ownership-scoped branch here — the
-- existing top-level sponsor.manage/super_admin bypass is sufficient
-- (unlike lesson_resource, which needs a narrower ownership-scoped branch
-- because TEACHER holders get courses.content.write without courses.manage).

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
  OR (
    "asset_attachments"."entity_type" = 'sponsor_document'
    AND EXISTS (SELECT 1 FROM project_documents pd WHERE pd."id" = "asset_attachments"."entity_id")
  )
);

DROP POLICY "asset_attachments_write" ON "asset_attachments";
CREATE POLICY "asset_attachments_write" ON "asset_attachments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
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

-- asset_attachments_delete gains only the top-level sponsor.manage bypass
-- (already covers deleting a sponsor_document attachment) — the
-- lesson_resource/message branches are otherwise UNCHANGED.
DROP POLICY "asset_attachments_delete" ON "asset_attachments";
CREATE POLICY "asset_attachments_delete" ON "asset_attachments" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
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
);
