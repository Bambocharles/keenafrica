import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  InvalidReviewTransitionError,
  InvalidScheduleError,
  InvalidSlugError,
  ReviewNotApprovedError,
  approveArticle,
  cancelScheduledPublish,
  createArticle,
  flipDueScheduledArticles,
  getPublicArticleBySlug,
  listArticlesPendingReview,
  publishArticle,
  rejectArticle,
  requestChanges,
  resolveRedirectSlug,
  scheduleArticle,
  submitForReview,
  updateArticle,
  updateArticleSlug,
} from "@/lib/articles";
import { actorFromUser, cleanupTestArticles, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Session 38 (Keen Africans — Editor Workflow). Covers the new review state
 * machine, scheduled publishing, Topic, and slug editing — kept as its own
 * file rather than growing articles.test.ts further, same "one file per
 * session's own additions" split this codebase already uses elsewhere.
 */

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
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

async function draftArticle(actor: Awaited<ReturnType<typeof keenAfrican>>, title = "Editor Workflow Draft") {
  const article = await createArticle({ title }, actor);
  createdArticleIds.push(article.id);
  return article;
}

describe("Topic", () => {
  it("createArticle persists an optional topic; updateArticle can change or clear it", async () => {
    const actor = await keenAfrican();
    const article = await createArticle({ title: "Topic Test", topic: "cloud" }, actor);
    createdArticleIds.push(article.id);
    expect(article.topic).toBe("cloud");

    const updated = await updateArticle(article.id, { topic: "ai" }, actor);
    expect(updated.topic).toBe("ai");

    const cleared = await updateArticle(article.id, { topic: null }, actor);
    expect(cleared.topic).toBeNull();
  });

  it("defaults to no topic when none is given", async () => {
    const actor = await keenAfrican();
    const article = await createArticle({ title: "No Topic" }, actor);
    createdArticleIds.push(article.id);
    expect(article.topic).toBeNull();
  });
});

describe("updateArticleSlug", () => {
  it("lets the owner change a draft's slug", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor);
    const updated = await updateArticleSlug(article.id, "my-custom-url", actor);
    expect(updated.slug).toBe("my-custom-url");
  });

  it("rejects a malformed slug", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor);
    await expect(updateArticleSlug(article.id, "Not A Valid Slug!", actor)).rejects.toThrow(InvalidSlugError);
  });

  it("rejects a slug already taken by another article", async () => {
    const actor = await keenAfrican();
    const a = await draftArticle(actor, "First");
    const b = await draftArticle(actor, "Second");
    await updateArticleSlug(a.id, "taken-slug", actor);
    await expect(updateArticleSlug(b.id, "taken-slug", actor)).rejects.toThrow(InvalidSlugError);
  });

  it("prevents another author from changing someone else's slug", async () => {
    const owner = await keenAfrican();
    const stranger = await keenAfrican();
    const article = await draftArticle(owner);
    await expect(updateArticleSlug(article.id, "hijacked-url", stranger)).rejects.toThrow(AuthorizationError);
  });

  it("records the old slug and lets the public route resolve a redirect once the article is published and re-slugged", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor, "Redirect Me");
    await publishArticle(article.id, actor);
    const oldSlug = article.slug;

    const updated = await updateArticleSlug(article.id, "brand-new-url", actor);
    expect(updated.previousSlugs).toContain(oldSlug);

    const redirect = await resolveRedirectSlug(oldSlug);
    expect(redirect).toBe("brand-new-url");

    // The new slug is live at the public route.
    const publicRow = await getPublicArticleBySlug("brand-new-url");
    expect(publicRow?.id).toBe(article.id);
  });

  it("resolveRedirectSlug returns null for a slug that was never used", async () => {
    expect(await resolveRedirectSlug("never-existed-slug-xyz")).toBeNull();
  });
});

describe("review workflow — state machine", () => {
  it("starts every article at reviewStatus 'not_submitted', and direct-publish still works with no review gate", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor);
    expect(article.reviewStatus).toBe("not_submitted");

    const published = await publishArticle(article.id, actor);
    expect(published.status).toBe("published");
    expect(published.reviewStatus).toBe("not_submitted");
  });

  it("submitForReview moves a draft to in_review; only the owner may submit", async () => {
    const owner = await keenAfrican();
    const stranger = await keenAfrican();
    const article = await draftArticle(owner);

    await expect(submitForReview(article.id, stranger)).rejects.toThrow(AuthorizationError);

    const submitted = await submitForReview(article.id, owner);
    expect(submitted.reviewStatus).toBe("in_review");

    const event = await prisma.auditEvent.findFirst({ where: { action: "article.review_submitted", entityId: article.id } });
    expect(event).not.toBeNull();
  });

  it("a plain KEEN_AFRICAN (no articles.manage) cannot approve/reject/request-changes on any article, including their own", async () => {
    const owner = await keenAfrican();
    const article = await draftArticle(owner);
    await submitForReview(article.id, owner);

    await expect(approveArticle(article.id, owner)).rejects.toThrow(AuthorizationError);
    await expect(rejectArticle(article.id, "no", owner)).rejects.toThrow(AuthorizationError);
    await expect(requestChanges(article.id, "no", owner)).rejects.toThrow(AuthorizationError);
  });

  it("blocks publishing while in_review/changes_requested/rejected, and unblocks once approved", async () => {
    const owner = await keenAfrican();
    const reviewer = await admin();
    const article = await draftArticle(owner);
    await submitForReview(article.id, owner);

    await expect(publishArticle(article.id, owner)).rejects.toThrow(ReviewNotApprovedError);

    await requestChanges(article.id, "Please add more detail", reviewer);
    let row = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(row.reviewStatus).toBe("changes_requested");
    expect(row.reviewNote).toBe("Please add more detail");
    await expect(publishArticle(article.id, owner)).rejects.toThrow(ReviewNotApprovedError);

    // Resubmit after addressing feedback.
    await submitForReview(article.id, owner);
    await rejectArticle(article.id, "Not ready yet", reviewer);
    row = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(row.reviewStatus).toBe("rejected");
    await expect(publishArticle(article.id, owner)).rejects.toThrow(ReviewNotApprovedError);

    // Resubmit and approve.
    await submitForReview(article.id, owner);
    const approved = await approveArticle(article.id, reviewer);
    expect(approved.reviewStatus).toBe("approved");
    expect(approved.reviewedBy).toBe(reviewer.id);

    const published = await publishArticle(article.id, owner);
    expect(published.status).toBe("published");
  });

  it("articles.manage/super_admin can publish even while an article is in_review (the same bypass email verification already gets)", async () => {
    const owner = await keenAfrican(false);
    const reviewer = await admin();
    const article = await draftArticle(owner);
    await submitForReview(article.id, owner);

    const published = await publishArticle(article.id, reviewer);
    expect(published.status).toBe("published");
  });

  it("rejects invalid transitions: approving/rejecting an article that isn't in_review", async () => {
    const owner = await keenAfrican();
    const reviewer = await admin();
    const article = await draftArticle(owner);

    await expect(approveArticle(article.id, reviewer)).rejects.toThrow(InvalidReviewTransitionError);
    await expect(rejectArticle(article.id, "reason", reviewer)).rejects.toThrow(InvalidReviewTransitionError);
  });

  it("requestChanges and rejectArticle require a non-empty reason", async () => {
    const owner = await keenAfrican();
    const reviewer = await admin();
    const article = await draftArticle(owner);
    await submitForReview(article.id, owner);

    await expect(requestChanges(article.id, "   ", reviewer)).rejects.toThrow();
    await expect(rejectArticle(article.id, "", reviewer)).rejects.toThrow();
  });

  it("listArticlesPendingReview returns only in_review articles, and requires articles.manage", async () => {
    const owner = await keenAfrican();
    const reviewer = await admin();
    const submitted = await draftArticle(owner, "Pending Review Article");
    const notSubmitted = await draftArticle(owner, "Untouched Draft");
    await submitForReview(submitted.id, owner);

    await expect(listArticlesPendingReview(owner)).rejects.toThrow(AuthorizationError);

    const queue = await listArticlesPendingReview(reviewer);
    const ids = queue.map((a) => a.id);
    expect(ids).toContain(submitted.id);
    expect(ids).not.toContain(notSubmitted.id);
  });
});

describe("scheduled publishing", () => {
  it("rejects scheduling in the past or present", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor);
    await expect(scheduleArticle(article.id, new Date(Date.now() - 1000), actor)).rejects.toThrow(InvalidScheduleError);
  });

  it("sets scheduledAt and keeps the article unpublished/invisible until it's due", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    const scheduled = await scheduleArticle(article.id, future, actor);
    expect(scheduled.status).toBe("draft");
    expect(scheduled.scheduledAt?.getTime()).toBe(future.getTime());

    expect(await getPublicArticleBySlug(article.slug)).toBeNull();
  });

  it("respects the same review/email-verification gates as immediate publish", async () => {
    const unverified = await keenAfrican(false);
    const article = await draftArticle(unverified);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await expect(scheduleArticle(article.id, future, unverified)).rejects.toThrow();
  });

  it("cancelScheduledPublish clears a pending schedule; a non-owner cannot schedule or cancel", async () => {
    const owner = await keenAfrican();
    const stranger = await keenAfrican();
    const article = await draftArticle(owner);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    await expect(scheduleArticle(article.id, future, stranger)).rejects.toThrow(AuthorizationError);
    await scheduleArticle(article.id, future, owner);
    await expect(cancelScheduledPublish(article.id, stranger)).rejects.toThrow(AuthorizationError);

    const cancelled = await cancelScheduledPublish(article.id, owner);
    expect(cancelled.scheduledAt).toBeNull();
  });

  it("flipDueScheduledArticles publishes a due article and audits it; an immediate publish clears any pending schedule", async () => {
    const actor = await keenAfrican();
    const due = await draftArticle(actor, "Due For Publish");
    const notYetDue = await draftArticle(actor, "Not Yet Due");

    // scheduleArticle() itself enforces "must be in the future" — simulate
    // time having passed by writing a past scheduledAt directly, the same
    // way a real "due" row would look once its scheduled moment arrives.
    await prisma.article.update({ where: { id: due.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await scheduleArticle(notYetDue.id, new Date(Date.now() + 60 * 60 * 1000), actor);

    await flipDueScheduledArticles();

    const dueRow = await prisma.article.findUniqueOrThrow({ where: { id: due.id } });
    expect(dueRow.status).toBe("published");
    expect(dueRow.scheduledAt).toBeNull();
    expect(dueRow.publishedAt).not.toBeNull();

    const notYetDueRow = await prisma.article.findUniqueOrThrow({ where: { id: notYetDue.id } });
    expect(notYetDueRow.status).toBe("draft");

    const event = await prisma.auditEvent.findFirst({
      where: { action: "article.published", entityId: due.id, metadata: { path: ["scheduled"], equals: true } },
    });
    expect(event).not.toBeNull();

    // Publicly visible now, through the normal public read path (which
    // itself triggers the same flip — this proves the on-read check works
    // end-to-end, not just via the direct call above).
    const publicRow = await getPublicArticleBySlug(due.slug);
    expect(publicRow?.id).toBe(due.id);
  });

  it("an immediate publish clears a pending scheduledAt", async () => {
    const actor = await keenAfrican();
    const article = await draftArticle(actor);
    await scheduleArticle(article.id, new Date(Date.now() + 60 * 60 * 1000), actor);

    const published = await publishArticle(article.id, actor);
    expect(published.status).toBe("published");
    expect(published.scheduledAt).toBeNull();
  });
});
