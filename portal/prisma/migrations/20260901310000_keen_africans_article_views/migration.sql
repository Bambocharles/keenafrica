-- Session 44 (Discovery, Search & Recommendations). See schema.prisma's
-- ArticleView comment for the full design — an append-only view-event log
-- that EXTENDS Session 42's Article.viewCount lifetime counter, never
-- duplicates it. Feeds Trending's recent-view-velocity signal and a
-- lightweight per-viewer dedup check in src/lib/articles.ts's
-- recordArticleView().
--
-- Note: this migration deliberately does NOT touch
-- "user_identities_user_id_fkey" — see the keen_africans_comments
-- migration's identical note for why (pre-existing Session 19 drift,
-- unrelated to this session — `prisma migrate dev` always proposes
-- dropping/re-adding it because the live DB's FK differs slightly from
-- what schema.prisma's declared relation would generate).

-- CreateTable
CREATE TABLE "article_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "viewer_key" TEXT NOT NULL,
    "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (Trending's own read path — see listTrendingArticles())
CREATE INDEX "article_views_article_id_viewed_at_idx" ON "article_views"("article_id", "viewed_at");

-- CreateIndex (recordArticleView()'s own dedup lookup)
CREATE INDEX "article_views_article_id_viewer_key_viewed_at_idx" ON "article_views"("article_id", "viewer_key", "viewed_at");

-- AddForeignKey
ALTER TABLE "article_views" ADD CONSTRAINT "article_views_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- article_views_select: unconditionally open — same "public engagement
-- signal, nothing private to protect" reasoning article_reactions_select/
-- follows_select already established. A view COUNT is already public via
-- Article.viewCount; a raw row here holds only a hashed viewer key, never
-- a raw IP address (see src/lib/articles.ts's hashViewerKey()).
--
-- article_views_insert: super_admin OR articles.manage ONLY — no
-- KEEN_AFRICAN/TEACHER/STUDENT role holds articles.manage (see
-- DEFAULT_ROLE_PERMISSIONS in src/lib/authz.ts), so a client can never
-- forge a view row directly. recordArticleView() only ever writes under
-- its own narrow systemArticlesCtx() (articles.manage, no real actor's own
-- permission set) — same "internal system context" shape
-- certificates_write/progress writes already use — never under a real
-- actor's own permission set.
--
-- No UPDATE/DELETE policy at all — an append-only log, same spirit as
-- audit_events. A future retention/pruning job (not built this session —
-- see docs/KEEN_AFRICANS.md's "Known limitations") would need its own
-- explicit DELETE policy scoped to that job's own system context.
ALTER TABLE "article_views" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "article_views_select" ON "article_views" FOR SELECT USING (true);

CREATE POLICY "article_views_insert" ON "article_views" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
);
