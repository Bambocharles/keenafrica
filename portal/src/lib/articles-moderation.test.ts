import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  createArticle,
  listArticlesByAuthorForAdmin,
  listArticlesForModeration,
  publishArticle,
  rejectArticle,
  submitForReview,
} from "@/lib/articles";
import { createReport } from "@/lib/reports";
import { actorFromUser, cleanupTestArticles, cleanupTestReports, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Covers
 * the new admin moderation queue (listArticlesForModeration — the real
 * filterable replacement for Session 34's flat published-only list) and
 * the per-author admin article view (listArticlesByAuthorForAdmin).
 */

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
  await cleanupTestReports(createdUserIds);
  await cleanupTestArticles(createdArticleIds);
  await cleanupTestUsers(createdUserIds);
});

async function keenAfrican() {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return { user, actor: await actorFromUser(user.id) };
}

async function admin() {
  const user = await createTestUser({ roles: ["ADMIN"] });
  createdUserIds.push(user.id);
  return actorFromUser(user.id);
}

describe("listArticlesForModeration — authorization boundary", () => {
  it("a plain KEEN_AFRICAN cannot call it", async () => {
    const { actor } = await keenAfrican();
    await expect(listArticlesForModeration(actor)).rejects.toThrow(AuthorizationError);
  });
});

describe("listArticlesForModeration — status filtering", () => {
  it("status: 'published' returns only published articles", async () => {
    const { actor } = await keenAfrican();
    const published = await createArticle({ title: `Mod Published ${Date.now()}` }, actor);
    createdArticleIds.push(published.id);
    await publishArticle(published.id, actor);

    const draft = await createArticle({ title: `Mod Draft ${Date.now()}` }, actor);
    createdArticleIds.push(draft.id);

    const moderator = await admin();
    const rows = await listArticlesForModeration(moderator, { status: "published" });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(draft.id);
  });

  it("status: 'pending_review' returns only in_review articles", async () => {
    const { actor } = await keenAfrican();
    const submitted = await createArticle({ title: `Mod Submitted ${Date.now()}` }, actor);
    createdArticleIds.push(submitted.id);
    await submitForReview(submitted.id, actor);

    const moderator = await admin();
    const rows = await listArticlesForModeration(moderator, { status: "pending_review" });
    expect(rows.map((r) => r.id)).toContain(submitted.id);
  });

  it("status: 'rejected' returns only review-rejected articles", async () => {
    const { actor } = await keenAfrican();
    const article = await createArticle({ title: `Mod Rejected ${Date.now()}` }, actor);
    createdArticleIds.push(article.id);
    await submitForReview(article.id, actor);
    const moderator = await admin();
    await rejectArticle(article.id, "not up to standard", moderator);

    const rows = await listArticlesForModeration(moderator, { status: "rejected" });
    expect(rows.map((r) => r.id)).toContain(article.id);
  });

  it("omitting status returns the union of pending_review + published + rejected, never a plain untouched draft", async () => {
    const { actor } = await keenAfrican();
    const untouchedDraft = await createArticle({ title: `Mod Untouched ${Date.now()}` }, actor);
    createdArticleIds.push(untouchedDraft.id);

    const moderator = await admin();
    const rows = await listArticlesForModeration(moderator);
    expect(rows.map((r) => r.id)).not.toContain(untouchedDraft.id);
  });
});

describe("listArticlesForModeration — reportedOnly filter", () => {
  it("reportedOnly narrows to articles with an open (pending) report, and every row carries a `reported` flag", async () => {
    const { actor } = await keenAfrican();
    const reported = await createArticle({ title: `Mod Reported ${Date.now()}` }, actor);
    createdArticleIds.push(reported.id);
    await publishArticle(reported.id, actor);

    const notReported = await createArticle({ title: `Mod Not Reported ${Date.now()}` }, actor);
    createdArticleIds.push(notReported.id);
    await publishArticle(notReported.id, actor);

    await createReport({ entityType: "article", entityId: reported.id, reason: "spam" }, null, "203.0.113.40");

    const moderator = await admin();
    const reportedOnly = await listArticlesForModeration(moderator, { reportedOnly: true });
    expect(reportedOnly.map((r) => r.id)).toContain(reported.id);
    expect(reportedOnly.map((r) => r.id)).not.toContain(notReported.id);

    const all = await listArticlesForModeration(moderator, { status: "published" });
    const reportedRow = all.find((r) => r.id === reported.id);
    const notReportedRow = all.find((r) => r.id === notReported.id);
    expect(reportedRow?.reported).toBe(true);
    expect(notReportedRow?.reported).toBe(false);
  });
});

describe("listArticlesByAuthorForAdmin — authorization boundary + coverage", () => {
  it("a plain KEEN_AFRICAN cannot view another author's articles this way", async () => {
    const { user: author } = await keenAfrican();
    const { actor: outsider } = await keenAfrican();
    await expect(listArticlesByAuthorForAdmin(author.id, outsider)).rejects.toThrow(AuthorizationError);
  });

  it("an articles.manage holder sees every one of the author's articles regardless of status", async () => {
    const { user: author, actor } = await keenAfrican();
    const draft = await createArticle({ title: `Author Draft ${Date.now()}` }, actor);
    createdArticleIds.push(draft.id);
    const published = await createArticle({ title: `Author Published ${Date.now()}` }, actor);
    createdArticleIds.push(published.id);
    await publishArticle(published.id, actor);

    const moderator = await admin();
    const rows = await listArticlesByAuthorForAdmin(author.id, moderator);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(draft.id);
    expect(ids).toContain(published.id);
  });
});
