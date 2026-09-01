-- Session 38 (Keen Africans — Editor Workflow). Article-scoped review
-- workflow taxonomy + scheduled publishing + slug-history. Both new enums
-- (ArticleReviewStatus, ArticleTopic) are brand-new types, not additions to
-- an existing enum, so — unlike the AssetEntityType/UserStatus value
-- additions elsewhere in this codebase — they can be created and used
-- within this same transaction; Postgres only forbids using a NEW VALUE of
-- an EXISTING enum type in the transaction that adds it.
--
-- No RLS policy changes: articles_select/write/update already govern the
-- whole row (RLS is row-level, not column-level — see the
-- keen_africans_articles migration's own comment), so every new column
-- here is already covered by the existing owner-or-articles.manage-or-
-- published-and-public policies. The one write path that is NOT a real
-- actor's own request — flipDueScheduledArticles()'s on-read scheduled-
-- publish flip — runs under a synthesized system context carrying only
-- articles.manage (src/lib/articles.ts's systemArticlesCtx()), which
-- articles_update already grants unconditionally; it needs no new policy
-- either.
CREATE TYPE "ArticleReviewStatus" AS ENUM ('not_submitted', 'in_review', 'changes_requested', 'approved', 'rejected');

CREATE TYPE "ArticleTopic" AS ENUM ('cloud', 'ai', 'engineering', 'entrepreneurship', 'career', 'business', 'culture');

ALTER TABLE "articles" ADD COLUMN "previous_slugs" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "articles" ADD COLUMN "topic" "ArticleTopic";
ALTER TABLE "articles" ADD COLUMN "review_status" "ArticleReviewStatus" NOT NULL DEFAULT 'not_submitted';
ALTER TABLE "articles" ADD COLUMN "review_note" TEXT;
ALTER TABLE "articles" ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);
ALTER TABLE "articles" ADD COLUMN "reviewed_by" UUID;
ALTER TABLE "articles" ADD COLUMN "scheduled_at" TIMESTAMPTZ(6);

ALTER TABLE "articles" ADD CONSTRAINT "articles_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "articles_status_scheduled_at_idx" ON "articles"("status", "scheduled_at");
CREATE INDEX "articles_review_status_idx" ON "articles"("review_status");
