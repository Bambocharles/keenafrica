-- Session 36 (Keen Africans — Profile & Identity) — extends Session 13's
-- Asset/File service for profile avatars, per that session's own
-- documented contract ("add an AssetEntityType value + a matching case in
-- canAccessAssetAttachment() + a matching RLS branch"). Split into its own
-- migration, after keen_africans_avatar_asset_entity_type, because the
-- 'avatar' AssetEntityType value it references cannot be used in the same
-- transaction that added it.
--
-- The select branch is unconditional (no published/draft gate, unlike
-- article_cover's cascade through articles_select) — a Profile has no
-- unpublished state; it is always fully public once it exists
-- (profiles_select is itself unconditionally open, see
-- keen_africans_profiles_core). An anonymous EXISTS against "profiles"
-- here therefore sees exactly the same rows an anonymous SELECT against
-- "profiles" directly would: all of them.
--
-- A profile carries at most one avatar — asset_attachments' existing
-- @@unique([entityType, entityId]) constraint (Session 13) already enforces
-- that, same as article_cover.
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
  OR (
    "asset_attachments"."entity_type" = 'certificate'
    AND EXISTS (SELECT 1 FROM certificates c WHERE c."id" = "asset_attachments"."entity_id")
  )
  OR (
    "asset_attachments"."entity_type" = 'article_cover'
    AND EXISTS (SELECT 1 FROM articles a WHERE a."id" = "asset_attachments"."entity_id")
  )
  OR (
    "asset_attachments"."entity_type" = 'avatar'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p."id" = "asset_attachments"."entity_id")
  )
);

-- Only the profile's own user may attach an avatar to it, mirroring
-- src/lib/profiles.ts's setAvatar() ownership check — plus the top-level
-- super_admin bypass every other branch already has. No permission-key
-- gate (unlike articles.write for article_cover) — same "self-only, no
-- ownership permission to check" shape as profiles_write/update
-- themselves.
DROP POLICY "asset_attachments_write" ON "asset_attachments";
CREATE POLICY "asset_attachments_write" ON "asset_attachments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
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
  OR (
    "asset_attachments"."entity_type" = 'article_cover'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND EXISTS (
      SELECT 1 FROM articles a
      WHERE a."id" = "asset_attachments"."entity_id" AND a."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
  OR (
    "asset_attachments"."entity_type" = 'avatar'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p."id" = "asset_attachments"."entity_id" AND p."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

-- Only the profile's own user may detach/replace its avatar, plus the same
-- top-level bypasses.
DROP POLICY "asset_attachments_delete" ON "asset_attachments";
CREATE POLICY "asset_attachments_delete" ON "asset_attachments" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'certificates.manage'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
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
    "asset_attachments"."entity_type" = 'article_cover'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND EXISTS (
      SELECT 1 FROM articles a
      WHERE a."id" = "asset_attachments"."entity_id" AND a."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
  OR (
    "asset_attachments"."entity_type" = 'avatar'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p."id" = "asset_attachments"."entity_id" AND p."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
