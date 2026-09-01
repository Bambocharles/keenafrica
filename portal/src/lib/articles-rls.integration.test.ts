import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_articles / keen_africans_asset_attachments
 * migrations' RLS policies are enforced by Postgres itself, against the
 * real non-superuser portal_rls_test role — see
 * src/lib/rls.integration.test.ts's header for why this matters. Mirrors
 * assets-rls.integration.test.ts's structure. Targets this session's own
 * acceptance criteria directly: published articles are readable by anyone
 * with no app.user_id set at all (the public site), and another Keen
 * African cannot write/update someone else's article even with a crafted
 * request, independent of whatever src/lib/articles.ts's own ownership
 * checks do.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Keen Africans Row-Level Security (enforced by a non-superuser role)", () => {
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

  /** Genuinely anonymous — mirrors withRls({}) as called by the public listing/reading pages. No session vars set at all. */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let author: { id: string };
  let outsider: { id: string };
  let admin: { id: string };
  let draftArticleId: string;
  let publishedArticleId: string;
  let publishedCoverAssetId: string;
  let draftCoverAssetId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `article-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    author = await mk("author");
    outsider = await mk("outsider");
    admin = await mk("admin");

    const draft = await setup.article.create({
      data: { authorId: author.id, title: "Draft Article", slug: `draft-${randomUUID()}`, body: "secret draft", authorName: "RLS author" },
      select: { id: true },
    });
    draftArticleId = draft.id;

    const published = await setup.article.create({
      data: {
        authorId: author.id,
        title: "Published Article",
        slug: `published-${randomUUID()}`,
        body: "public body",
        authorName: "RLS author",
        status: "published",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    publishedArticleId = published.id;

    const mkAsset = (label: string) =>
      setup.asset.create({
        data: {
          uploaderId: author.id,
          originalFilename: `${label}.png`,
          mimeType: "image/png",
          sizeBytes: 10,
          storageDriver: "local",
          storageKey: randomUUID(),
          checksumSha256: "0".repeat(64),
        },
        select: { id: true },
      });

    const publishedCover = await mkAsset("published-cover");
    publishedCoverAssetId = publishedCover.id;
    await setup.assetAttachment.create({
      data: { assetId: publishedCoverAssetId, entityType: "article_cover", entityId: publishedArticleId, attachedBy: author.id },
    });
    await setup.article.update({ where: { id: publishedArticleId }, data: { coverAssetId: publishedCoverAssetId } });

    const draftCover = await mkAsset("draft-cover");
    draftCoverAssetId = draftCover.id;
    await setup.assetAttachment.create({
      data: { assetId: draftCoverAssetId, entityType: "article_cover", entityId: draftArticleId, attachedBy: author.id },
    });
    await setup.article.update({ where: { id: draftArticleId }, data: { coverAssetId: draftCoverAssetId } });

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.assetAttachment.deleteMany({ where: { entityId: { in: [draftArticleId, publishedArticleId] } } });
    await setup.article.deleteMany({ where: { id: { in: [draftArticleId, publishedArticleId] } } });
    await setup.asset.deleteMany({ where: { id: { in: [publishedCoverAssetId, draftCoverAssetId] } } });
    await setup.user.deleteMany({ where: { id: { in: [author.id, outsider.id, admin.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("articles_select: an anonymous caller (no app.user_id at all) can read the published article", async () => {
    const row = await asAnonymous((tx) => tx.article.findUnique({ where: { id: publishedArticleId } }));
    expect(row?.id).toBe(publishedArticleId);
  });

  it("articles_select: an anonymous caller cannot read the draft article", async () => {
    const row = await asAnonymous((tx) => tx.article.findUnique({ where: { id: draftArticleId } }));
    expect(row).toBeNull();
  });

  it("articles_select: an unrelated logged-in Keen African cannot read another author's draft either", async () => {
    const row = await asContext({ userId: outsider.id, permissions: ["articles.write"] }, (tx) =>
      tx.article.findUnique({ where: { id: draftArticleId } })
    );
    expect(row).toBeNull();
  });

  it("articles_select: the author can read their own draft", async () => {
    const row = await asContext({ userId: author.id, permissions: ["articles.write"] }, (tx) =>
      tx.article.findUnique({ where: { id: draftArticleId } })
    );
    expect(row?.id).toBe(draftArticleId);
  });

  it("articles_write: a Keen African cannot spoof another user's author_id", async () => {
    await expect(
      asContext({ userId: outsider.id, permissions: ["articles.write"] }, (tx) =>
        tx.article.create({
          data: { authorId: author.id, title: "Spoofed", slug: `spoofed-${randomUUID()}`, body: "x", authorName: "RLS author" },
        })
      )
    ).rejects.toThrow();
  });

  it("articles_write: holding articles.write with no matching author_id grants nothing", async () => {
    await expect(
      asContext({ userId: outsider.id, permissions: [] }, (tx) =>
        tx.article.create({
          data: { authorId: outsider.id, title: "No permission", slug: `noperm-${randomUUID()}`, body: "x", authorName: "RLS outsider" },
        })
      )
    ).rejects.toThrow();
  });

  it("articles_update: an outsider cannot update another author's article, even one they can read (published)", async () => {
    await expect(
      asContext({ userId: outsider.id, permissions: ["articles.write"] }, (tx) =>
        tx.article.update({ where: { id: publishedArticleId }, data: { title: "Hijacked" } })
      )
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const row = await setup.article.findUniqueOrThrow({ where: { id: publishedArticleId } });
    expect(row.title).toBe("Published Article");
    await setup.$disconnect();
  });

  it("articles_update: articles.manage (admin) can update any article", async () => {
    const updated = await asContext({ userId: admin.id, permissions: ["articles.manage"] }, (tx) =>
      tx.article.update({ where: { id: publishedArticleId }, data: { moderationNote: "reviewed" } })
    );
    expect(updated.moderationNote).toBe("reviewed");
  });

  it("asset_attachments/assets cascade: an anonymous caller can see a published article's cover asset", async () => {
    const attachment = await asAnonymous((tx) =>
      tx.assetAttachment.findFirst({ where: { assetId: publishedCoverAssetId, entityType: "article_cover" } })
    );
    expect(attachment).not.toBeNull();

    const asset = await asAnonymous((tx) => tx.asset.findUnique({ where: { id: publishedCoverAssetId } }));
    expect(asset?.id).toBe(publishedCoverAssetId);
  });

  it("regression: an anonymous caller can read a published article WITHOUT a nested author include throwing — users_select has no anonymous branch, so a naive `include: { author }` on this query would still 500 in production. Session 34 fixed this with an elevated-context workaround (authorNamesByIds()); Session 36 removed that workaround entirely by denormalizing authorName onto Article and moving the profile-link lookup to the (unconditionally public) profiles table instead — see src/lib/articles.ts's listPublishedArticles()/getPublicArticleBySlug(). This test still proves the underlying users_select behavior holds, so nobody re-introduces the bug by adding a relation include here later.", async () => {
    // This is the exact shape src/lib/db.ts's application code runs under
    // withRls({}) — proven directly against the real restricted role
    // rather than the local-dev superuser connection every other test file
    // implicitly runs through (see src/lib/test-support.ts's own docstring:
    // "in local dev this is the Postgres superuser connection, bypasses
    // RLS entirely" — which is exactly why this class of bug was invisible
    // to every other test in this session and only surfaced live in prod).
    const article = await asAnonymous((tx) => tx.article.findFirst({ where: { id: publishedArticleId } }));
    expect(article?.id).toBe(publishedArticleId);

    // The bug: a plain relation include on the same query, run anonymously.
    // users_select denies the anonymous caller entirely, so Prisma's inner
    // join for the required (non-optional) author relation comes back
    // null and Prisma throws "Inconsistent query result: Field author is
    // required to return data, got `null` instead" — reproduced here.
    await expect(
      asAnonymous((tx) =>
        tx.article.findFirst({ where: { id: publishedArticleId }, include: { author: { select: { name: true } } } })
      )
    ).rejects.toThrow();
  });

  it("asset_attachments/assets cascade: an anonymous caller cannot see a draft article's cover asset", async () => {
    const attachment = await asAnonymous((tx) =>
      tx.assetAttachment.findFirst({ where: { assetId: draftCoverAssetId, entityType: "article_cover" } })
    );
    expect(attachment).toBeNull();

    const asset = await asAnonymous((tx) => tx.asset.findUnique({ where: { id: draftCoverAssetId } }));
    expect(asset).toBeNull();
  });
});
