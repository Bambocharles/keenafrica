-- Session 43 (Comments & Reactions). See schema.prisma's Comment comment
-- for the full design.
--
-- Note: this migration deliberately does NOT touch
-- "user_identities_user_id_fkey" — `prisma migrate diff`'s output proposed
-- dropping/recreating it (RESTRICT/CASCADE vs. the already-applied
-- NO ACTION/NO ACTION) purely because UserIdentity.user has never declared
-- explicit onDelete/onUpdate in schema.prisma; that's pre-existing drift
-- from Session 19, unrelated to this session's scope, so it was stripped
-- from the generated SQL rather than silently applied here — same call
-- every prior Keen Africans migration touching this diff noise has made.

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_article_id_created_at_idx" ON "comments"("article_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_author_id_idx" ON "comments"("author_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- comments_select: publicly readable (no login) exactly when the parent
-- article is published — same "no actor condition needed" shape
-- articles_select's own published branch uses. The comment's own author
-- can always read their own comment (e.g. on a moment where the article
-- has since been taken down), and articles.manage/super_admin can always
-- read everything, for moderation. Deleted comments are NOT filtered out
-- at this layer (deletedAt has no RLS condition) — src/lib/comments.ts's
-- listCommentsForArticle() is the actual "hide deleted comments from the
-- public thread" boundary; the row itself is retained (see the
-- soft-delete reasoning on the Comment model) so a Report against it
-- still resolves.
--
-- comments_write (INSERT): ownership-scoped exactly like articles_write —
-- articles.write alone (with no matching author_id on the new row) grants
-- nothing. This is the same "holding articles.write is this codebase's
-- proxy for 'is a registered, engaging Keen African'" signal
-- src/lib/comments.ts's own application-layer check uses.
--
-- comments_update: THREE self-service branches, matching this session's
-- own "Owns" bullet exactly — (1) the comment's own author (self-delete),
-- (2) the PARENT ARTICLE's own author (moderating comments on their own
-- article — a subquery against "articles", same pattern
-- keen_african_verifications' self-connect policy uses for a
-- cross-table check), or (3) articles.manage/super_admin (platform-wide
-- moderation). src/lib/comments.ts's deleteComment() is the only writer
-- through this policy in practice (a soft-delete UPDATE, never a raw
-- column edit exposed to a client) — same "RLS is row-level, not
-- column-level" caveat articles_update's own comment documents.
--
-- No DELETE policy for any role — see the Comment model's own comment for
-- why a hard delete is never allowed here.
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON "comments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR "comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM articles a WHERE a.id = "comments"."article_id" AND a.status = 'published'
  )
);

CREATE POLICY "comments_write" ON "comments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND "comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY "comments_update" ON "comments" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR "comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM articles a
    WHERE a.id = "comments"."article_id"
      AND a.author_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
  OR "comments"."author_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (
    SELECT 1 FROM articles a
    WHERE a.id = "comments"."article_id"
      AND a.author_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
);
