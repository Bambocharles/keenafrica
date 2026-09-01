-- Session 36 (Keen Africans — Profile & Identity). Denormalized authorName
-- snapshot on Article — see schema.prisma's Article.authorName comment.
-- Added nullable first so the backfill below can populate every existing
-- row (the founding article + anything created since Session 34) before
-- the NOT NULL constraint is enforced; this migration script runs as a
-- privileged migration role (not the RLS-restricted app runtime role), so
-- the backfill itself needs no RLS carve-out.
--
-- No profiles exist yet at the point this migration runs (this is a
-- brand-new table, created by the immediately-preceding
-- keen_africans_profiles_core migration) — so the only fallback source for
-- historical rows is "users.name" directly. Every article created from
-- this point forward gets its authorName set by
-- src/lib/articles.ts's createArticle() (via resolveAuthorName()), which
-- prefers the author's Profile.displayName once one exists.
ALTER TABLE "articles" ADD COLUMN "author_name" TEXT;

UPDATE "articles" a
SET "author_name" = COALESCE(u."name", 'Keen African')
FROM "users" u
WHERE u."id" = a."author_id";

ALTER TABLE "articles" ALTER COLUMN "author_name" SET NOT NULL;
