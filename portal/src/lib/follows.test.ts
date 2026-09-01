import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createArticle, publishArticle, recordArticleView } from "@/lib/articles";
import { ensureProfile } from "@/lib/profiles";
import * as events from "@/lib/events";
import {
  AlreadyFollowingError,
  CannotFollowSelfError,
  FollowTargetNotFoundError,
  followUser,
  getAuthorReputation,
  getFollowerCount,
  getFollowingCount,
  isFollowing,
  listPeopleToFollow,
  unfollowUser,
} from "@/lib/follows";
import { actorFromUser, cleanupTestArticles, cleanupTestFollows, cleanupTestProfiles, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Session 42 (Follow & Author Reputation Display). Covers followUser()/
 * unfollowUser() (this session's own explicit acceptance criteria: can't
 * follow self, can't double-follow, unfollow works), the public read
 * surface (isFollowing/getFollowerCount/getFollowingCount), and
 * getAuthorReputation()'s article/view/follower aggregation.
 */

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
  await cleanupTestFollows(createdUserIds);
  await cleanupTestArticles(createdArticleIds);
  await cleanupTestProfiles(createdUserIds);
  await cleanupTestUsers(createdUserIds);
});

async function keenAfrican(name = "Keen African", verified = false) {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  if (verified) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  const actor = await actorFromUser(user.id);
  const profile = await ensureProfile(actor, { name });
  return { user, actor, profile };
}

describe("followUser", () => {
  it("lets one Keen African follow another", async () => {
    const a = await keenAfrican("Follower A");
    const b = await keenAfrican("Followed B");

    const follow = await followUser(b.user.id, a.actor);
    expect(follow.followerId).toBe(a.actor.id);
    expect(follow.followingId).toBe(b.user.id);
    expect(await isFollowing(a.actor.id, b.user.id)).toBe(true);
  });

  it("cannot follow yourself", async () => {
    const a = await keenAfrican("Self Follower");
    await expect(followUser(a.actor.id, a.actor)).rejects.toThrow(CannotFollowSelfError);
  });

  it("cannot double-follow", async () => {
    const a = await keenAfrican("Double Follower");
    const b = await keenAfrican("Double Followed");
    await followUser(b.user.id, a.actor);

    await expect(followUser(b.user.id, a.actor)).rejects.toThrow(AlreadyFollowingError);
  });

  it("throws FollowTargetNotFoundError for a user with no public profile", async () => {
    const a = await keenAfrican("Lonely Follower");
    const noProfile = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(noProfile.id);

    await expect(followUser(noProfile.id, a.actor)).rejects.toThrow(FollowTargetNotFoundError);
  });

  it("is audited", async () => {
    const a = await keenAfrican("Audited Follower");
    const b = await keenAfrican("Audited Followed");
    const follow = await followUser(b.user.id, a.actor);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "follow.created", entityId: b.user.id, actorId: a.actor.id },
    });
    expect(audit).toBeTruthy();
    expect((audit?.metadata as { followId?: string } | null)?.followId).toBe(follow.id);
  });

  it("emits UserFollowed with the follower and followed ids, never on unfollow", async () => {
    const a = await keenAfrican("Event Follower");
    const b = await keenAfrican("Event Followed");
    const spy = vi.spyOn(events, "emitDomainEvent");

    await followUser(b.user.id, a.actor);
    expect(spy).toHaveBeenCalledWith("UserFollowed", { followerId: a.actor.id, followedUserId: b.user.id });

    spy.mockClear();
    await unfollowUser(b.user.id, a.actor);
    expect(spy).not.toHaveBeenCalledWith("UserFollowed", expect.anything());

    spy.mockRestore();
  });
});

describe("unfollowUser", () => {
  it("removes the follow relationship", async () => {
    const a = await keenAfrican("Unfollower A");
    const b = await keenAfrican("Unfollowed B");
    await followUser(b.user.id, a.actor);
    expect(await isFollowing(a.actor.id, b.user.id)).toBe(true);

    const result = await unfollowUser(b.user.id, a.actor);
    expect(result.removed).toBe(true);
    expect(await isFollowing(a.actor.id, b.user.id)).toBe(false);
  });

  it("is idempotent — unfollowing when not following is not an error", async () => {
    const a = await keenAfrican("Idempotent Unfollower");
    const b = await keenAfrican("Never Followed");

    const result = await unfollowUser(b.user.id, a.actor);
    expect(result.removed).toBe(false);
  });

  it("only removes the caller's own follow, not someone else's", async () => {
    const a = await keenAfrican("Other Follower A");
    const c = await keenAfrican("Other Follower C");
    const b = await keenAfrican("Shared Target B");
    await followUser(b.user.id, a.actor);
    await followUser(b.user.id, c.actor);

    await unfollowUser(b.user.id, a.actor);
    expect(await isFollowing(a.actor.id, b.user.id)).toBe(false);
    expect(await isFollowing(c.actor.id, b.user.id)).toBe(true);
  });
});

describe("isFollowing / getFollowerCount / getFollowingCount — public reads", () => {
  it("isFollowing returns false for an unauthenticated/undefined follower id", async () => {
    const b = await keenAfrican("Anon Target");
    expect(await isFollowing(undefined, b.user.id)).toBe(false);
    expect(await isFollowing(null, b.user.id)).toBe(false);
  });

  it("counts followers and following correctly across multiple relationships", async () => {
    const hub = await keenAfrican("Popular Hub");
    const f1 = await keenAfrican("Fan One");
    const f2 = await keenAfrican("Fan Two");

    await followUser(hub.user.id, f1.actor);
    await followUser(hub.user.id, f2.actor);
    await followUser(f1.user.id, hub.actor);

    expect(await getFollowerCount(hub.user.id)).toBe(2);
    expect(await getFollowingCount(hub.user.id)).toBe(1);
    expect(await getFollowerCount(f1.user.id)).toBe(1);
  });
});

describe("getAuthorReputation", () => {
  it("aggregates published article count, total views, and follower/following counts", async () => {
    const author = await keenAfrican("Reputable Author", true);
    const fan = await keenAfrican("Reputation Fan");
    await followUser(author.user.id, fan.actor);

    const draft = await createArticle({ title: "Still drafting, not counted" }, author.actor);
    createdArticleIds.push(draft.id);
    const published1 = await createArticle({ title: "Published One" }, author.actor);
    createdArticleIds.push(published1.id);
    await publishArticle(published1.id, author.actor);
    const published2 = await createArticle({ title: "Published Two" }, author.actor);
    createdArticleIds.push(published2.id);
    await publishArticle(published2.id, author.actor);

    await recordArticleView(published1.id);
    await recordArticleView(published1.id);
    await recordArticleView(published2.id);

    const reputation = await getAuthorReputation(author.user.id);
    expect(reputation.articleCount).toBe(2);
    expect(reputation.totalViews).toBe(3);
    expect(reputation.followerCount).toBe(1);
    expect(reputation.followingCount).toBe(0);
  });

  it("returns zeros for an author with no published articles or followers", async () => {
    const author = await keenAfrican("Quiet Author");
    const reputation = await getAuthorReputation(author.user.id);
    expect(reputation).toEqual({ articleCount: 0, totalViews: 0, followerCount: 0, followingCount: 0 });
  });
});

describe("listPeopleToFollow (Session 44 — Discovery, Search & Recommendations)", () => {
  it("suggests published authors, excluding the viewer themself and anyone already followed", async () => {
    const viewer = await keenAfrican("PTF Viewer");
    const popular = await keenAfrican("PTF Popular Author", true);
    const alreadyFollowed = await keenAfrican("PTF Already Followed Author", true);
    const fan1 = await keenAfrican("PTF Fan One");
    const fan2 = await keenAfrican("PTF Fan Two");

    const popularArticle = await createArticle({ title: "PTF Popular Piece" }, popular.actor);
    createdArticleIds.push(popularArticle.id);
    await publishArticle(popularArticle.id, popular.actor);
    const followedArticle = await createArticle({ title: "PTF Already Followed Piece" }, alreadyFollowed.actor);
    createdArticleIds.push(followedArticle.id);
    await publishArticle(followedArticle.id, alreadyFollowed.actor);

    await followUser(popular.user.id, fan1.actor);
    await followUser(popular.user.id, fan2.actor);
    await followUser(alreadyFollowed.user.id, viewer.actor);

    const suggestions = await listPeopleToFollow(viewer.user.id, 20);
    const ids = suggestions.map((s) => s.userId);

    expect(ids).toContain(popular.user.id);
    expect(ids).not.toContain(alreadyFollowed.user.id);
    expect(ids).not.toContain(viewer.user.id);

    const popularEntry = suggestions.find((s) => s.userId === popular.user.id);
    expect(popularEntry?.followerCount).toBeGreaterThanOrEqual(2);
    expect(popularEntry?.articleCount).toBeGreaterThanOrEqual(1);
  });

  it("excludes an author with zero published articles (drafts-only or none at all)", async () => {
    const viewer = await keenAfrican("PTF Viewer 2");
    const noArticlesAtAll = await keenAfrican("PTF No Articles Author");
    const draftOnly = await keenAfrican("PTF Draft Only Author");
    const draft = await createArticle({ title: "PTF Never Published" }, draftOnly.actor);
    createdArticleIds.push(draft.id);
    // Deliberately never published.

    const suggestions = await listPeopleToFollow(viewer.user.id, 50);
    const ids = suggestions.map((s) => s.userId);
    expect(ids).not.toContain(noArticlesAtAll.user.id);
    expect(ids).not.toContain(draftOnly.user.id);
  });

  it("works for a signed-out viewer (undefined) — no already-following exclusion applies", async () => {
    const author = await keenAfrican("PTF Anonymous-Viewer Author", true);
    const article = await createArticle({ title: "PTF Anonymous Viewer Piece" }, author.actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, author.actor);

    const suggestions = await listPeopleToFollow(undefined, 50);
    expect(suggestions.some((s) => s.userId === author.user.id)).toBe(true);
  });
});
