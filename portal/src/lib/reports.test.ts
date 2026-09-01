import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { createArticle, publishArticle } from "@/lib/articles";
import { createComment } from "@/lib/comments";
import { ensureProfile } from "@/lib/profiles";
import {
  InvalidReportTransitionError,
  ReportNotFoundError,
  ReportRateLimitedError,
  ReportTargetNotFoundError,
  REPORT_ACCOUNT_WINDOW,
  createReport,
  dismissReport,
  getOpenReportEntityIds,
  listReports,
  resolveReport,
} from "@/lib/reports";
import {
  actorFromUser,
  cleanupTestArticles,
  cleanupTestComments,
  cleanupTestReports,
  cleanupTestUsers,
  createTestUser,
} from "@/lib/test-support";

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Covers
 * createReport() (anonymous-capable, rate-limited, validates the target
 * exists) and the articles.manage-gated review surface
 * (listReports/resolveReport/dismissReport/getOpenReportEntityIds).
 */

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];
const createdCommentIds: string[] = [];

afterAll(async () => {
  await cleanupTestComments(createdCommentIds);
  await cleanupTestReports(createdUserIds);
  await cleanupTestArticles(createdArticleIds);
  await cleanupTestUsers(createdUserIds);
});

async function keenAfrican() {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  const actor = await actorFromUser(user.id);
  await ensureProfile(actor, { name: "Reported Person" });
  return { user, actor };
}

async function admin() {
  const user = await createTestUser({ roles: ["ADMIN"] });
  createdUserIds.push(user.id);
  return actorFromUser(user.id);
}

/** A fresh, unique-per-call IP for every rate-limit test — a literal like "203.0.113.7" would collide with audit_events left over from a PRIOR run of this same test file (anonymous report.created events aren't cleaned up by user id, since there's no user), silently pre-tripping the limiter. */
function randomIp(): string {
  const n = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${parseInt(n.slice(0, 2), 16)}.${parseInt(n.slice(2, 4), 16)}.${parseInt(n.slice(4, 6), 16)}.${parseInt(n.slice(6, 8), 16)}`;
}

async function publishedArticle() {
  const { actor } = await keenAfrican();
  const article = await createArticle({ title: `Report Target ${Date.now()}-${Math.random()}` }, actor);
  createdArticleIds.push(article.id);
  return article;
}

describe("createReport — anonymous-capable, rate-limited", () => {
  it("an anonymous caller (no actor) can report an article", async () => {
    const article = await publishedArticle();
    await expect(createReport({ entityType: "article", entityId: article.id, reason: "spam" }, null, randomIp())).resolves.toBeUndefined();
  });

  it("a logged-in reader can report a profile", async () => {
    const { user: target } = await keenAfrican();
    const { actor: reporter } = await keenAfrican();
    await expect(
      createReport({ entityType: "profile", entityId: target.id, reason: "impersonation" }, reporter, randomIp())
    ).resolves.toBeUndefined();
  });

  it("rejects an empty reason", async () => {
    const article = await publishedArticle();
    await expect(createReport({ entityType: "article", entityId: article.id, reason: "   " }, null, randomIp())).rejects.toThrow();
  });

  it("throws ReportTargetNotFoundError for an article that doesn't exist", async () => {
    await expect(
      createReport({ entityType: "article", entityId: "00000000-0000-0000-0000-000000000000", reason: "spam" }, null, randomIp())
    ).rejects.toThrow(ReportTargetNotFoundError);
  });

  it("throws ReportTargetNotFoundError for a profile that doesn't exist", async () => {
    await expect(
      createReport({ entityType: "profile", entityId: "00000000-0000-0000-0000-000000000000", reason: "spam" }, null, randomIp())
    ).rejects.toThrow(ReportTargetNotFoundError);
  });

  it("Session 43 (Comments & Reactions): a logged-in reader can report a comment", async () => {
    const { user: authorUser, actor: author } = await keenAfrican();
    await prisma.user.update({ where: { id: authorUser.id }, data: { emailVerifiedAt: new Date() } });
    const article = await createArticle({ title: `Comment Report Target ${Date.now()}-${Math.random()}` }, author);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, author);

    const { user: commenterUser, actor: commenter } = await keenAfrican();
    await prisma.user.update({ where: { id: commenterUser.id }, data: { emailVerifiedAt: new Date() } });
    const comment = await createComment(article.id, "reportable comment", commenter);
    createdCommentIds.push(comment.id);
    const { actor: reporter } = await keenAfrican();

    await expect(
      createReport({ entityType: "comment", entityId: comment.id, reason: "harassment" }, reporter, randomIp())
    ).resolves.toBeUndefined();
  });

  it("throws ReportTargetNotFoundError for a comment that doesn't exist", async () => {
    await expect(
      createReport({ entityType: "comment", entityId: "00000000-0000-0000-0000-000000000000", reason: "spam" }, null, randomIp())
    ).rejects.toThrow(ReportTargetNotFoundError);
  });

  it("rate-limits repeated reports from the same account — the report mechanism itself must not become an abuse vector", async () => {
    const article = await publishedArticle();
    const { actor: reporter } = await keenAfrican();
    const ip = randomIp();

    for (let i = 0; i < REPORT_ACCOUNT_WINDOW.maxAttempts; i++) {
      await createReport({ entityType: "article", entityId: article.id, reason: `spam ${i}` }, reporter, ip);
    }

    await expect(
      createReport({ entityType: "article", entityId: article.id, reason: "one too many" }, reporter, ip)
    ).rejects.toThrow(ReportRateLimitedError);
  });

  it("rate-limits repeated anonymous reports from the same IP", async () => {
    const article = await publishedArticle();
    const ip = randomIp();

    for (let i = 0; i < 8; i++) {
      await createReport({ entityType: "article", entityId: article.id, reason: `spam ${i}` }, null, ip);
    }

    await expect(createReport({ entityType: "article", entityId: article.id, reason: "one more" }, null, ip)).rejects.toThrow(
      ReportRateLimitedError
    );
  });
});

describe("listReports — articles.manage-gated", () => {
  it("a plain KEEN_AFRICAN cannot list reports", async () => {
    const { actor } = await keenAfrican();
    await expect(listReports(actor)).rejects.toThrow(AuthorizationError);
  });

  it("an articles.manage holder sees pending reports, filterable by status/entityType", async () => {
    const article = await publishedArticle();
    await createReport({ entityType: "article", entityId: article.id, reason: "spam here" }, null, randomIp());
    const moderator = await admin();

    const pending = await listReports(moderator, { status: "pending" });
    expect(pending.some((r) => r.entityId === article.id && r.reason === "spam here")).toBe(true);

    const articleOnly = await listReports(moderator, { entityType: "article" });
    expect(articleOnly.every((r) => r.entityType === "article")).toBe(true);
  });
});

describe("getOpenReportEntityIds — articles.manage-gated", () => {
  it("a plain KEEN_AFRICAN cannot call it", async () => {
    const { actor } = await keenAfrican();
    await expect(getOpenReportEntityIds("article", actor)).rejects.toThrow(AuthorizationError);
  });

  it("returns only entities with a PENDING report, never reviewed/dismissed ones", async () => {
    const reported = await publishedArticle();
    const notReported = await publishedArticle();
    await createReport({ entityType: "article", entityId: reported.id, reason: "spam" }, null, randomIp());
    const moderator = await admin();

    const ids = await getOpenReportEntityIds("article", moderator);
    expect(ids.has(reported.id)).toBe(true);
    expect(ids.has(notReported.id)).toBe(false);
  });
});

describe("resolveReport / dismissReport — articles.manage-gated, audited", () => {
  it("a plain KEEN_AFRICAN cannot resolve or dismiss a report", async () => {
    const article = await publishedArticle();
    await createReport({ entityType: "article", entityId: article.id, reason: "spam" }, null, randomIp());
    const moderator = await admin();
    const [report] = await listReports(moderator, { status: "pending" });
    const { actor: outsider } = await keenAfrican();

    await expect(resolveReport(report.id, outsider)).rejects.toThrow(AuthorizationError);
    await expect(dismissReport(report.id, outsider)).rejects.toThrow(AuthorizationError);
  });

  it("resolveReport marks it reviewed and audits the decision", async () => {
    const article = await publishedArticle();
    await createReport({ entityType: "article", entityId: article.id, reason: "spam" }, null, randomIp());
    const moderator = await admin();
    const [report] = await listReports(moderator, { status: "pending" });

    const updated = await resolveReport(report.id, moderator, "unpublished the article");
    expect(updated.status).toBe("reviewed");
    expect(updated.reviewedBy).toBe(moderator.id);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "report.resolved", metadata: { path: ["reportId"], equals: report.id } },
    });
    expect(audit).toBeTruthy();
  });

  it("dismissReport marks it dismissed and audits the decision", async () => {
    const article = await publishedArticle();
    await createReport({ entityType: "article", entityId: article.id, reason: "not actually spam" }, null, randomIp());
    const moderator = await admin();
    const [report] = await listReports(moderator, { status: "pending" });

    const updated = await dismissReport(report.id, moderator, "no action warranted");
    expect(updated.status).toBe("dismissed");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "report.dismissed", metadata: { path: ["reportId"], equals: report.id } },
    });
    expect(audit).toBeTruthy();
  });

  it("cannot resolve/dismiss a report that was already reviewed", async () => {
    const article = await publishedArticle();
    await createReport({ entityType: "article", entityId: article.id, reason: "spam" }, null, randomIp());
    const moderator = await admin();
    const [report] = await listReports(moderator, { status: "pending" });
    await resolveReport(report.id, moderator);

    await expect(resolveReport(report.id, moderator)).rejects.toThrow(InvalidReportTransitionError);
    await expect(dismissReport(report.id, moderator)).rejects.toThrow(InvalidReportTransitionError);
  });

  it("throws ReportNotFoundError for an unknown report id", async () => {
    const moderator = await admin();
    await expect(resolveReport("00000000-0000-0000-0000-000000000000", moderator)).rejects.toThrow(ReportNotFoundError);
  });
});
