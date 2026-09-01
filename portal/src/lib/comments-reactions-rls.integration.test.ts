import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_comments and keen_africans_article_reactions
 * migrations' RLS policies are enforced by Postgres itself, against the
 * real non-superuser portal_rls_test role — see
 * src/lib/rls.integration.test.ts's header for why this matters. Targets
 * this session's own explicit requirements directly: a comment thread must
 * be publicly readable only when the parent article is published, writing
 * a comment/reaction must be ownership-scoped at the DB level (not just an
 * application-layer check a crafted request could bypass), and comment
 * deletion must allow all three self-service tiers (comment author,
 * article author, articles.manage) while a hard DELETE is never allowed
 * for either table.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Keen Africans Comments & Reactions Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean; permissions?: string[] },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      return fn(tx);
    });
  }

  /** Genuinely anonymous — mirrors withRls({}) as called by an unauthenticated reader. */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let articleAuthor: { id: string };
  let commentAuthor: { id: string };
  let moderator: { id: string };
  let outsider: { id: string };
  let publishedArticleId: string;
  let draftArticleId: string;
  let publishedCommentId: string;
  let draftCommentId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    const mk = (label: string) =>
      setup.user.create({
        data: { email: `comments-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    articleAuthor = await mk("article-author");
    commentAuthor = await mk("comment-author");
    moderator = await mk("moderator");
    outsider = await mk("outsider");

    const published = await setup.article.create({
      data: {
        authorId: articleAuthor.id,
        title: "RLS Comment Target",
        slug: `rls-comment-target-${randomUUID()}`,
        body: "body",
        authorName: "RLS Article Author",
        status: "published",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    publishedArticleId = published.id;

    const draft = await setup.article.create({
      data: {
        authorId: articleAuthor.id,
        title: "RLS Draft Comment Target",
        slug: `rls-draft-comment-target-${randomUUID()}`,
        body: "body",
        authorName: "RLS Article Author",
        status: "draft",
      },
      select: { id: true },
    });
    draftArticleId = draft.id;

    const publishedComment = await setup.comment.create({
      data: { articleId: publishedArticleId, authorId: commentAuthor.id, authorName: "RLS Comment Author", body: "hello" },
      select: { id: true },
    });
    publishedCommentId = publishedComment.id;

    const draftComment = await setup.comment.create({
      data: { articleId: draftArticleId, authorId: commentAuthor.id, authorName: "RLS Comment Author", body: "hello draft" },
      select: { id: true },
    });
    draftCommentId = draftComment.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.articleReaction.deleteMany({ where: { articleId: { in: [publishedArticleId, draftArticleId] } } });
    await setup.comment.deleteMany({ where: { id: { in: [publishedCommentId, draftCommentId] } } });
    await setup.article.deleteMany({ where: { id: { in: [publishedArticleId, draftArticleId] } } });
    await setup.user.deleteMany({ where: { id: { in: [articleAuthor.id, commentAuthor.id, moderator.id, outsider.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  describe("comments_select", () => {
    it("an anonymous caller can read a comment on a PUBLISHED article", async () => {
      const row = await asAnonymous((tx) => tx.comment.findUnique({ where: { id: publishedCommentId } }));
      expect(row?.id).toBe(publishedCommentId);
    });

    it("an anonymous caller CANNOT read a comment on a draft article", async () => {
      const row = await asAnonymous((tx) => tx.comment.findUnique({ where: { id: draftCommentId } }));
      expect(row).toBeNull();
    });

    it("the comment's own author can read it even on a draft article", async () => {
      const row = await asContext({ userId: commentAuthor.id }, (tx) => tx.comment.findUnique({ where: { id: draftCommentId } }));
      expect(row?.id).toBe(draftCommentId);
    });

    it("articles.manage can read a comment on a draft article", async () => {
      const row = await asContext({ userId: moderator.id, permissions: ["articles.manage"] }, (tx) =>
        tx.comment.findUnique({ where: { id: draftCommentId } })
      );
      expect(row?.id).toBe(draftCommentId);
    });

    it("an unrelated outsider cannot read a comment on a draft article", async () => {
      const row = await asContext({ userId: outsider.id }, (tx) => tx.comment.findUnique({ where: { id: draftCommentId } }));
      expect(row).toBeNull();
    });
  });

  describe("comments_write", () => {
    it("a holder of articles.write can insert a comment with a matching author_id", async () => {
      const created = await asContext({ userId: commentAuthor.id, permissions: ["articles.write"] }, (tx) =>
        tx.comment.create({
          data: { articleId: publishedArticleId, authorId: commentAuthor.id, authorName: "x", body: "rls insert" },
        })
      );
      expect(created.authorId).toBe(commentAuthor.id);
      const setup = new PrismaClient();
      await setup.comment.delete({ where: { id: created.id } });
      await setup.$disconnect();
    });

    it("holding articles.write does NOT allow inserting a comment authored as someone else", async () => {
      await expect(
        asContext({ userId: outsider.id, permissions: ["articles.write"] }, (tx) =>
          tx.comment.create({
            data: { articleId: publishedArticleId, authorId: commentAuthor.id, authorName: "x", body: "spoofed" },
          })
        )
      ).rejects.toThrow();
    });

    it("a caller with no articles.write at all cannot insert a comment", async () => {
      await expect(
        asContext({ userId: outsider.id }, (tx) =>
          tx.comment.create({
            data: { articleId: publishedArticleId, authorId: outsider.id, authorName: "x", body: "no permission" },
          })
        )
      ).rejects.toThrow();
    });
  });

  describe("comments_update (soft-delete) — three self-service tiers", () => {
    async function freshComment() {
      const setup = new PrismaClient();
      const created = await setup.comment.create({
        data: { articleId: publishedArticleId, authorId: commentAuthor.id, authorName: "x", body: "fresh" },
        select: { id: true },
      });
      await setup.$disconnect();
      return created.id;
    }

    it("an unrelated outsider cannot soft-delete a comment", async () => {
      const id = await freshComment();
      await expect(
        asContext({ userId: outsider.id }, (tx) =>
          tx.comment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: outsider.id } })
        )
      ).rejects.toThrow();
      const setup = new PrismaClient();
      await setup.comment.delete({ where: { id } });
      await setup.$disconnect();
    });

    it("the comment's own author CAN soft-delete it", async () => {
      const id = await freshComment();
      const updated = await asContext({ userId: commentAuthor.id }, (tx) =>
        tx.comment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: commentAuthor.id } })
      );
      expect(updated.deletedAt).not.toBeNull();
      const setup = new PrismaClient();
      await setup.comment.delete({ where: { id } });
      await setup.$disconnect();
    });

    it("the PARENT ARTICLE's own author CAN soft-delete someone else's comment on their own article", async () => {
      const id = await freshComment();
      const updated = await asContext({ userId: articleAuthor.id }, (tx) =>
        tx.comment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: articleAuthor.id } })
      );
      expect(updated.deletedAt).not.toBeNull();
      const setup = new PrismaClient();
      await setup.comment.delete({ where: { id } });
      await setup.$disconnect();
    });

    it("articles.manage CAN soft-delete any comment", async () => {
      const id = await freshComment();
      const updated = await asContext({ userId: moderator.id, permissions: ["articles.manage"] }, (tx) =>
        tx.comment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: moderator.id } })
      );
      expect(updated.deletedAt).not.toBeNull();
      const setup = new PrismaClient();
      await setup.comment.delete({ where: { id } });
      await setup.$disconnect();
    });

    it("no DELETE policy exists — a raw DELETE affects zero rows even for the comment's own author", async () => {
      const id = await freshComment();
      const { count } = await asContext({ userId: commentAuthor.id }, (tx) => tx.comment.deleteMany({ where: { id } }));
      expect(count).toBe(0);
      const setup = new PrismaClient();
      await setup.comment.delete({ where: { id } });
      await setup.$disconnect();
    });
  });

  describe("article_reactions", () => {
    it("select: an anonymous caller can read reactions (public reputation signal)", async () => {
      const setup = new PrismaClient();
      const created = await setup.articleReaction.create({
        data: { articleId: publishedArticleId, userId: commentAuthor.id },
        select: { id: true },
      });
      await setup.$disconnect();

      const row = await asAnonymous((tx) => tx.articleReaction.findUnique({ where: { id: created.id } }));
      expect(row?.id).toBe(created.id);

      const cleanup = new PrismaClient();
      await cleanup.articleReaction.delete({ where: { id: created.id } });
      await cleanup.$disconnect();
    });

    it("insert: a holder of articles.write can react as themselves", async () => {
      const created = await asContext({ userId: outsider.id, permissions: ["articles.write"] }, (tx) =>
        tx.articleReaction.create({ data: { articleId: publishedArticleId, userId: outsider.id } })
      );
      expect(created.userId).toBe(outsider.id);
      const setup = new PrismaClient();
      await setup.articleReaction.delete({ where: { id: created.id } });
      await setup.$disconnect();
    });

    it("insert: holding articles.write does NOT allow reacting as someone else", async () => {
      await expect(
        asContext({ userId: outsider.id, permissions: ["articles.write"] }, (tx) =>
          tx.articleReaction.create({ data: { articleId: publishedArticleId, userId: commentAuthor.id } })
        )
      ).rejects.toThrow();
    });

    it("delete: only the reactor's own row can be removed", async () => {
      const setup = new PrismaClient();
      const created = await setup.articleReaction.create({
        data: { articleId: publishedArticleId, userId: commentAuthor.id },
        select: { id: true },
      });
      await setup.$disconnect();

      const outsiderAttempt = await asContext({ userId: outsider.id }, (tx) =>
        tx.articleReaction.deleteMany({ where: { id: created.id } })
      );
      expect(outsiderAttempt.count).toBe(0);

      const ownerAttempt = await asContext({ userId: commentAuthor.id }, (tx) =>
        tx.articleReaction.deleteMany({ where: { id: created.id } })
      );
      expect(ownerAttempt.count).toBe(1);
    });
  });
});
