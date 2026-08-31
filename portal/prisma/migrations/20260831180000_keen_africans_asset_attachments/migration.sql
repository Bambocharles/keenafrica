-- Session 34 (Keen Africans) — extends Session 13's Asset/File service for
-- article cover images, per that session's own documented contract ("add an
-- AssetEntityType value + a matching case in canAccessAssetAttachment() +
-- a matching RLS branch"). Split into its own migration, after the
-- keen_africans_asset_entity_type migration, because the 'article_cover'
-- AssetEntityType value it references cannot be used in the same
-- transaction that added it.
--
-- The select branch is what makes a published article's cover image
-- publicly downloadable with no login: it cascades through articles'
-- own RLS policy (articles_select, previous migration) exactly like the
-- sponsor_document/certificate branches cascade through their own tables —
-- no duplicated visibility logic. articles_select already returns
-- status='published' rows to an anonymous caller (empty app.user_id), so an
-- anonymous EXISTS against "articles" here sees exactly the same rows an
-- anonymous SELECT against "articles" directly would. A draft/archived
-- article's cover stays invisible to everyone but its author/moderators,
-- same as the article row itself.
--
-- An article carries at most one cover — asset_attachments' existing
-- @@unique([entityType, entityId]) constraint (Session 13) already enforces
-- that.

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
);

-- Only the article's own author (holding articles.write) may attach a
-- cover to it, mirroring src/lib/articles.ts's setCoverImage() ownership
-- check — plus the top-level articles.manage/super_admin bypass every
-- other branch already has.
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
);

-- Only the article's own author (holding articles.write) may detach/replace
-- its cover, plus the same top-level bypasses.
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
);
