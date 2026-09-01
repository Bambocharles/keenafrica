import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { createArticle, publishArticle, renderArticleBodyHtml, EmailNotVerifiedError } from "@/lib/articles";
import { createReport, getOpenReportEntityIds } from "@/lib/reports";
import {
  CommentNotFoundError,
  CommentRateLimitedError,
  CommentTargetNotFoundError,
  COMMENT_CREATE_WINDOW,
  createComment,
  deleteComment,
  listCommentsForArticle,
} from "@/lib/comments";
import {
  actorFromUser,
  cleanupTestArticles,
  cleanupTestComments,
  cleanupTestReports,
  cleanupTestUsers,
  createTestUser,
} from "@/lib/test-support";

/**
 * Session 43 (Comments & Reactions). Covers createComment()/deleteComment()
 * (this session's own acceptance criteria: create/read/delete, the
 * three-tier delete authorization — comment author, article author,
 * articles.manage — email verification gate, rate limiting), and proves
 * the shared sanitize-html pipeline directly against comment bodies with
 * the same kind of XSS payloads src/lib/articles.test.ts already uses
 * against article bodies (this session's own explicit acceptance
 * criterion).
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

async function keenAfrican(verified = true) {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  if (verified) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  return actorFromUser(user.id);
}

async function admin() {
  const user = await createTestUser({ roles: ["ADMIN"] });
  createdUserIds.push(user.id);
  return actorFromUser(user.id);
}

async function publishedArticle(author?: Awaited<ReturnType<typeof keenAfrican>>) {
  const authorActor = author ?? (await keenAfrican());
  const article = await createArticle({ title: `Comment Target ${Date.now()}-${Math.random()}` }, authorActor);
  createdArticleIds.push(article.id);
  await publishArticle(article.id, authorActor);
  return { article, authorActor };
}

describe("createComment", () => {
  it("creates a comment on a published article, snapshotting the author's display name", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();

    const comment = await createComment(article.id, "Great read!", commenter);
    createdCommentIds.push(comment.id);

    expect(comment.articleId).toBe(article.id);
    expect(comment.authorId).toBe(commenter.id);
    expect(comment.body).toBe("Great read!");
    expect(comment.authorName).toBeTruthy();
  });

  it("rejects an empty/whitespace-only body", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    await expect(createComment(article.id, "   ", commenter)).rejects.toThrow();
  });

  it("rejects a plain (non-Keen-African) authenticated user", async () => {
    const { article } = await publishedArticle();
    const student = await createTestUser({ roles: ["STUDENT"] });
    createdUserIds.push(student.id);
    const actor = await actorFromUser(student.id);
    await expect(createComment(article.id, "hi", actor)).rejects.toThrow(AuthorizationError);
  });

  it("rejects an unverified Keen African", async () => {
    const { article } = await publishedArticle();
    const unverified = await keenAfrican(false);
    await expect(createComment(article.id, "hi", unverified)).rejects.toThrow(EmailNotVerifiedError);
  });

  it("throws CommentTargetNotFoundError for a draft article", async () => {
    const author = await keenAfrican();
    const draft = await createArticle({ title: `Draft ${Date.now()}` }, author);
    createdArticleIds.push(draft.id);
    const commenter = await keenAfrican();
    await expect(createComment(draft.id, "hi", commenter)).rejects.toThrow(CommentTargetNotFoundError);
  });

  it("throws CommentTargetNotFoundError for an unknown article id", async () => {
    const commenter = await keenAfrican();
    await expect(
      createComment("00000000-0000-0000-0000-000000000000", "hi", commenter)
    ).rejects.toThrow(CommentTargetNotFoundError);
  });

  it("records a comment.created audit event", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "audited comment", commenter);
    createdCommentIds.push(comment.id);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "comment.created", entityId: comment.id, actorId: commenter.id },
    });
    expect(audit).toBeTruthy();
  });

  it("rate-limits repeated comment creation from the same account", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();

    for (let i = 0; i < COMMENT_CREATE_WINDOW.maxAttempts; i++) {
      const comment = await createComment(article.id, `comment ${i}`, commenter);
      createdCommentIds.push(comment.id);
    }

    await expect(createComment(article.id, "one too many", commenter)).rejects.toThrow(CommentRateLimitedError);
  });
});

describe("renderArticleBodyHtml applied to comment bodies — the shared sanitize-html pipeline, not a second one", () => {
  it("strips a raw <script> tag embedded in a comment body, the same XSS defense articles.test.ts proves for article bodies", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, 'Nice post <script>alert(document.cookie)</script>', commenter);
    createdCommentIds.push(comment.id);

    const html = renderArticleBodyHtml(comment.body);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event-handler attributes and javascript: URLs from a comment body", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(
      article.id,
      '<img src="x" onerror="alert(1)"> and <a href="javascript:alert(1)">click</a>',
      commenter
    );
    createdCommentIds.push(comment.id);

    const html = renderArticleBodyHtml(comment.body);
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });
});

describe("listCommentsForArticle — public, anonymous read", () => {
  it("returns comments oldest-first and excludes soft-deleted ones", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const first = await createComment(article.id, "first", commenter);
    createdCommentIds.push(first.id);
    const second = await createComment(article.id, "second", commenter);
    createdCommentIds.push(second.id);

    await deleteComment(second.id, commenter);

    const visible = await listCommentsForArticle(article.id);
    expect(visible.map((c) => c.id)).toEqual([first.id]);
  });
});

describe("deleteComment — three self-service tiers", () => {
  it("the comment's own author can delete their own comment", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "delete me", commenter);
    createdCommentIds.push(comment.id);

    const updated = await deleteComment(comment.id, commenter);
    expect(updated.deletedAt).not.toBeNull();
    expect(updated.deletedBy).toBe(commenter.id);
  });

  it("the ARTICLE's own author can delete someone else's comment on their own article", async () => {
    const author = await keenAfrican();
    const { article } = await publishedArticle(author);
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "moderate me", commenter);
    createdCommentIds.push(comment.id);

    const updated = await deleteComment(comment.id, author);
    expect(updated.deletedAt).not.toBeNull();
    expect(updated.deletedBy).toBe(author.id);
  });

  it("articles.manage can delete any comment, anywhere", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "moderate me too", commenter);
    createdCommentIds.push(comment.id);
    const moderator = await admin();

    const updated = await deleteComment(comment.id, moderator);
    expect(updated.deletedAt).not.toBeNull();
  });

  it("an unrelated Keen African (not the comment author, article author, or a moderator) cannot delete it", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "leave me alone", commenter);
    createdCommentIds.push(comment.id);
    const outsider = await keenAfrican();

    await expect(deleteComment(comment.id, outsider)).rejects.toThrow(AuthorizationError);
  });

  it("throws CommentNotFoundError for an unknown comment id", async () => {
    const moderator = await admin();
    await expect(deleteComment("00000000-0000-0000-0000-000000000000", moderator)).rejects.toThrow(
      CommentNotFoundError
    );
  });

  it("throws CommentNotFoundError for an already-deleted comment (soft-delete is not idempotent-visible)", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "delete twice", commenter);
    createdCommentIds.push(comment.id);
    await deleteComment(comment.id, commenter);

    await expect(deleteComment(comment.id, commenter)).rejects.toThrow(CommentNotFoundError);
  });

  it("records comment.deleted for a self-delete and comment.removed_by_moderator for a moderation removal", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();

    const selfDeleted = await createComment(article.id, "self", commenter);
    createdCommentIds.push(selfDeleted.id);
    await deleteComment(selfDeleted.id, commenter);
    const selfAudit = await prisma.auditEvent.findFirst({ where: { action: "comment.deleted", entityId: selfDeleted.id } });
    expect(selfAudit).toBeTruthy();

    const modDeleted = await createComment(article.id, "mod", commenter);
    createdCommentIds.push(modDeleted.id);
    const moderator = await admin();
    await deleteComment(modDeleted.id, moderator);
    const modAudit = await prisma.auditEvent.findFirst({
      where: { action: "comment.removed_by_moderator", entityId: modDeleted.id },
    });
    expect(modAudit).toBeTruthy();
  });
});

describe("comments are reportable through Session 41's existing reporting mechanism", () => {
  it("createReport accepts entityType 'comment' and it shows up via getOpenReportEntityIds", async () => {
    const { article } = await publishedArticle();
    const commenter = await keenAfrican();
    const comment = await createComment(article.id, "report me", commenter);
    createdCommentIds.push(comment.id);

    await createReport({ entityType: "comment", entityId: comment.id, reason: "spam" }, null, "203.0.113.201");

    const moderator = await admin();
    const ids = await getOpenReportEntityIds("comment", moderator);
    expect(ids.has(comment.id)).toBe(true);
  });
});
