-- Session 43 (Comments & Reactions). See schema.prisma's ArticleReaction
-- comment for the full design — same "single reaction type, per-user-per-
-- article, hard delete on remove" shape as Follow (Session 42).
--
-- Note: this migration deliberately does NOT touch
-- "user_identities_user_id_fkey" — see the keen_africans_comments
-- migration's identical note for why.

-- CreateTable
CREATE TABLE "article_reactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_reactions_article_id_idx" ON "article_reactions"("article_id");

-- CreateIndex
CREATE INDEX "article_reactions_user_id_idx" ON "article_reactions"("user_id");

-- CreateIndex (also the "can't double-react" DB-layer guarantee)
CREATE UNIQUE INDEX "article_reactions_article_id_user_id_key" ON "article_reactions"("article_id", "user_id");

-- AddForeignKey
ALTER TABLE "article_reactions" ADD CONSTRAINT "article_reactions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_reactions" ADD CONSTRAINT "article_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- article_reactions_select: unconditionally open — a reaction count (and
-- whether the current viewer has reacted) is a public signal, same "no
-- draft/private state to protect" reasoning follows_select established.
--
-- article_reactions_insert: the reactor's own row only, gated on
-- articles.write (this codebase's "is a registered, engaging Keen
-- African" proxy — same signal comments_write uses) — same ownership
-- shape follows_insert uses (minus the "no self-follow" check, which has
-- no equivalent concept here).
--
-- article_reactions_delete: the reactor's own row only — unreacting is
-- always self-service, same shape follows_delete uses.
--
-- No UPDATE policy — a reaction row is never edited in place, only
-- created or deleted.
ALTER TABLE "article_reactions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "article_reactions_select" ON "article_reactions" FOR SELECT USING (true);

CREATE POLICY "article_reactions_insert" ON "article_reactions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.write'
    AND "article_reactions"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  )
);

CREATE POLICY "article_reactions_delete" ON "article_reactions" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "article_reactions"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
