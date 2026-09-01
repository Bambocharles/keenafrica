import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { createArticle, publishArticle, EmailNotVerifiedError } from "@/lib/articles";
import {
  AlreadyReactedError,
  ReactionRateLimitedError,
  ReactionTargetNotFoundError,
  REACTION_WINDOW,
  getReactionCount,
  hasReacted,
  reactToArticle,
  unreactToArticle,
} from "@/lib/reactions";
import { actorFromUser, cleanupTestArticles, cleanupTestReactions, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Session 43 (Comments & Reactions). Covers reactToArticle()/
 * unreactToArticle() — this session's own acceptance criteria: reactions
 * work (create/toggle, can't double-react, unreact removes it) and are
 * rate-limited, gated the same way comments are (Keen African + verified
 * email).
 */

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
  await cleanupTestReactions(createdUserIds);
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

async function publishedArticle() {
  const author = await keenAfrican();
  const article = await createArticle({ title: `Reaction Target ${Date.now()}-${Math.random()}` }, author);
  createdArticleIds.push(article.id);
  await publishArticle(article.id, author);
  return article;
}

describe("reactToArticle", () => {
  it("lets a verified Keen African react to a published article", async () => {
    const article = await publishedArticle();
    const reactor = await keenAfrican();

    const reaction = await reactToArticle(article.id, reactor);
    expect(reaction.articleId).toBe(article.id);
    expect(reaction.userId).toBe(reactor.id);
    expect(await hasReacted(reactor.id, article.id)).toBe(true);
    expect(await getReactionCount(article.id)).toBe(1);
  });

  it("cannot double-react to the same article", async () => {
    const article = await publishedArticle();
    const reactor = await keenAfrican();
    await reactToArticle(article.id, reactor);

    await expect(reactToArticle(article.id, reactor)).rejects.toThrow(AlreadyReactedError);
  });

  it("rejects a plain (non-Keen-African) authenticated user", async () => {
    const article = await publishedArticle();
    const student = await createTestUser({ roles: ["STUDENT"] });
    createdUserIds.push(student.id);
    const actor = await actorFromUser(student.id);
    await expect(reactToArticle(article.id, actor)).rejects.toThrow(AuthorizationError);
  });

  it("rejects an unverified Keen African", async () => {
    const article = await publishedArticle();
    const unverified = await keenAfrican(false);
    await expect(reactToArticle(article.id, unverified)).rejects.toThrow(EmailNotVerifiedError);
  });

  it("throws ReactionTargetNotFoundError for a draft article", async () => {
    const author = await keenAfrican();
    const draft = await createArticle({ title: `Draft ${Date.now()}` }, author);
    createdArticleIds.push(draft.id);
    const reactor = await keenAfrican();
    await expect(reactToArticle(draft.id, reactor)).rejects.toThrow(ReactionTargetNotFoundError);
  });

  it("records a reaction.created audit event", async () => {
    const article = await publishedArticle();
    const reactor = await keenAfrican();
    await reactToArticle(article.id, reactor);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "reaction.created", entityId: article.id, actorId: reactor.id },
    });
    expect(audit).toBeTruthy();
  });

  it("rate-limits repeated reacting from the same account (toggled on/off against one article)", async () => {
    const article = await publishedArticle();
    const reactor = await keenAfrican();

    for (let i = 0; i < REACTION_WINDOW.maxAttempts; i++) {
      await reactToArticle(article.id, reactor);
      await unreactToArticle(article.id, reactor);
    }

    await expect(reactToArticle(article.id, reactor)).rejects.toThrow(ReactionRateLimitedError);
  });
});

describe("unreactToArticle", () => {
  it("removes the reaction", async () => {
    const article = await publishedArticle();
    const reactor = await keenAfrican();
    await reactToArticle(article.id, reactor);

    const result = await unreactToArticle(article.id, reactor);
    expect(result.removed).toBe(true);
    expect(await hasReacted(reactor.id, article.id)).toBe(false);
    expect(await getReactionCount(article.id)).toBe(0);
  });

  it("is idempotent — unreacting when not reacted is not an error", async () => {
    const article = await publishedArticle();
    const reactor = await keenAfrican();
    const result = await unreactToArticle(article.id, reactor);
    expect(result.removed).toBe(false);
  });

  it("only removes the caller's own reaction, not someone else's", async () => {
    const article = await publishedArticle();
    const a = await keenAfrican();
    const b = await keenAfrican();
    await reactToArticle(article.id, a);
    await reactToArticle(article.id, b);

    await unreactToArticle(article.id, a);
    expect(await hasReacted(a.id, article.id)).toBe(false);
    expect(await hasReacted(b.id, article.id)).toBe(true);
    expect(await getReactionCount(article.id)).toBe(1);
  });
});

describe("hasReacted / getReactionCount — public reads", () => {
  it("hasReacted returns false for an unauthenticated/undefined user id", async () => {
    const article = await publishedArticle();
    expect(await hasReacted(undefined, article.id)).toBe(false);
    expect(await hasReacted(null, article.id)).toBe(false);
  });

  it("counts reactions across multiple reactors", async () => {
    const article = await publishedArticle();
    const a = await keenAfrican();
    const b = await keenAfrican();
    await reactToArticle(article.id, a);
    await reactToArticle(article.id, b);

    expect(await getReactionCount(article.id)).toBe(2);
  });
});
