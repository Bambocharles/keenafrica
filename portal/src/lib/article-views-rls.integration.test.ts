import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Discovery, Search & Recommendations (Session 44). Proves the
 * keen_africans_article_views migration's RLS policies are enforced by
 * Postgres itself, against the real non-superuser portal_rls_test role —
 * see src/lib/rls.integration.test.ts's header for why this matters.
 * Targets this session's own explicit "must not be trivially gameable"
 * rule directly: a crafted INSERT (not just src/lib/articles.ts's own
 * recordArticleView() logic) must be unable to fabricate a view row
 * without holding articles.manage — the one permission
 * recordArticleView()'s own systemArticlesCtx() carries and no
 * KEEN_AFRICAN/TEACHER/STUDENT role holds (see DEFAULT_ROLE_PERMISSIONS).
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Keen Africans ArticleView Row-Level Security (enforced by a non-superuser role)", () => {
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

  /** Genuinely anonymous — mirrors withRls({}) as called by the public article page's own view-count read/write. */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let author: { id: string };
  let plainReader: { id: string };
  let moderator: { id: string };
  let articleId: string;
  let seededViewId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    const mk = (label: string) =>
      setup.user.create({
        data: { email: `article-views-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    author = await mk("author");
    plainReader = await mk("reader");
    moderator = await mk("moderator");

    const article = await setup.article.create({
      data: {
        authorId: author.id,
        title: "RLS Fixture Article",
        slug: `rls-fixture-${randomUUID()}`,
        body: "Body.",
        authorName: "RLS Author",
        status: "published",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    articleId = article.id;

    const view = await setup.articleView.create({
      data: { articleId, viewerKey: "user:seed" },
      select: { id: true },
    });
    seededViewId = view.id;
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.articleView.deleteMany({ where: { articleId } });
    await setup.article.deleteMany({ where: { id: articleId } });
    await setup.user.deleteMany({ where: { id: { in: [author.id, plainReader.id, moderator.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("select: a genuinely anonymous caller CAN read article_views (public engagement signal, same as Article.viewCount)", async () => {
    const row = await asAnonymous((tx) => tx.articleView.findUnique({ where: { id: seededViewId } }));
    expect(row?.id).toBe(seededViewId);
  });

  it("insert: a genuinely anonymous caller cannot insert a view row directly", async () => {
    await expect(
      asAnonymous((tx) => tx.$executeRaw`INSERT INTO article_views (article_id, viewer_key) VALUES (${articleId}::uuid, 'forged-anon')`)
    ).rejects.toThrow();
  });

  it("insert: an authenticated caller with NO articles.manage permission cannot insert a view row — the actual backstop against a client forging its own view count", async () => {
    await expect(
      asContext({ userId: plainReader.id }, (tx) =>
        tx.$executeRaw`INSERT INTO article_views (article_id, viewer_key) VALUES (${articleId}::uuid, 'forged-by-plain-reader')`
      )
    ).rejects.toThrow();
  });

  it("insert: articles.manage holder CAN insert — the exact permission recordArticleView()'s own systemArticlesCtx() carries", async () => {
    await asContext({ userId: moderator.id, permissions: ["articles.manage"] }, (tx) =>
      tx.$executeRaw`INSERT INTO article_views (article_id, viewer_key) VALUES (${articleId}::uuid, 'via-articles-manage')`
    );

    const setup = new PrismaClient();
    const created = await setup.articleView.findFirstOrThrow({ where: { articleId, viewerKey: "via-articles-manage" } });
    await setup.articleView.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });

  it("insert: super_admin can insert regardless of permissions", async () => {
    await asContext({ userId: moderator.id, isSuperAdmin: true }, (tx) =>
      tx.$executeRaw`INSERT INTO article_views (article_id, viewer_key) VALUES (${articleId}::uuid, 'via-super-admin')`
    );

    const setup = new PrismaClient();
    const created = await setup.articleView.findFirstOrThrow({ where: { articleId, viewerKey: "via-super-admin" } });
    await setup.articleView.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });
});
