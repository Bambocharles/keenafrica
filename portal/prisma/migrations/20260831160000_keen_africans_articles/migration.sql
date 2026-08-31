-- Session 34 (Keen Africans). The Article entity.
--
-- Reuses ContentStatus (draft -> published -> archived), the same enum
-- Module/Lesson already use (education_core migration) — no new status
-- type, per PLATFORM_ARCHITECTURE.md §7's shared content-lifecycle
-- convention. "body" is Markdown text; it is NEVER rendered as raw HTML —
-- src/lib/articles.ts's renderArticleBodyHtml() (marked + sanitize-html)
-- is the only path from this column to a browser. cover_asset_id is a
-- direct FK (same shape as resources.asset_id), with an accompanying
-- AssetAttachment row (entity_type='article_cover') so the general Asset
-- visibility model needs no bypass for it — see the
-- keen_africans_asset_attachments migration that follows this one.
CREATE TABLE "articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "author_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "excerpt" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT '{}',
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "cover_asset_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "moderated_at" TIMESTAMPTZ(6),
    "moderated_by" UUID,
    "moderation_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");
CREATE INDEX "articles_author_id_idx" ON "articles"("author_id");
CREATE INDEX "articles_status_published_at_idx" ON "articles"("status", "published_at");

ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "articles" ADD CONSTRAINT "articles_cover_asset_id_fkey" FOREIGN KEY ("cover_asset_id") REFERENCES "assets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "articles" ADD CONSTRAINT "articles_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- articles_select: the "publicly readable without login" acceptance
-- criterion's actual DB-level backstop — "status = 'published'" has no
-- actor condition at all, so it holds true even for a request with no
-- app.user_id set (withRls({}), the public listing/reading path). Draft/
-- archived articles are visible only to their author, articles.manage
-- holders, or super_admin.
--
-- articles_write/update: ownership-scoped exactly like
-- courses.content.write/cohort_teachers — articles.write alone (with no
-- matching author_id) grants nothing. Same "RLS is row-level, not
-- column-level" limitation already documented on assets_update/
-- certificates_update: an author holding articles.write can UPDATE any
-- column on their own row (including moderation_note), not just the
-- fields src/lib/articles.ts's own functions expose — acceptable because
-- every real write still goes through that module, never a client-exposed
-- raw update.
--
-- No DELETE policy for any role — an article is never hard-deleted, only
-- moved to status='archived' (same append-only-history spirit as
-- certificates/assets).
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY articles_select ON "articles" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR "articles"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "articles"."status" = 'published'
);

CREATE POLICY articles_write ON "articles" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND "articles"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY articles_update ON "articles" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND "articles"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND "articles"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
