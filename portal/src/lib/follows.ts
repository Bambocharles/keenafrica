import { withRls } from "@/lib/rls";
import { actorRlsCtx } from "@/lib/courses";
import type { AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";

/**
 * Follow & Author Reputation Display (Session 42). A follower/following
 * relationship between two canonical Users — see schema.prisma's Follow
 * comment for the full data-model design (the three-layer "can't follow
 * yourself" guarantee, the "can't double-follow" unique constraint, why
 * unfollow is a real DELETE).
 *
 * The only entry points into this table are the follow/unfollow button on
 * the public Keen Africans profile page and the article byline — both
 * require the target to already have a Profile row (checked below), which
 * in practice scopes following to Keen Africans authors without this
 * module needing a role check of its own, same "Profile as the
 * public-safe boundary" reasoning Session 36 established for public reads
 * elsewhere in this codebase.
 *
 * Authorization: no dedicated permission key — any authenticated actor may
 * follow/unfollow, same "every authenticated user is entitled to this,
 * there is nothing ownership-scoped to check beyond identity" shape
 * src/lib/profiles.ts's own header documents for Profile self-updates.
 * Enforced both in application code (this file) AND independently at the
 * RLS layer (keen_africans_follows migration) — the standard this
 * codebase's ownership checks meet everywhere else.
 */

export class CannotFollowSelfError extends Error {
  constructor(message = "You cannot follow yourself") {
    super(message);
    this.name = "CannotFollowSelfError";
  }
}

export class AlreadyFollowingError extends Error {
  constructor(message = "You are already following this account") {
    super(message);
    this.name = "AlreadyFollowingError";
  }
}

export class FollowTargetNotFoundError extends Error {
  constructor(message = "That account could not be found") {
    super(message);
    this.name = "FollowTargetNotFoundError";
  }
}

// --- Write (self-service, no permission key — identity is the only check) -

/**
 * Follow another Keen African. Throws CannotFollowSelfError,
 * FollowTargetNotFoundError, or AlreadyFollowingError — three distinct,
 * separately-testable failure modes per this session's own acceptance
 * criteria ("can't follow self, can't double-follow"). The existence check
 * runs before the double-follow check so a request against a genuinely
 * unknown/non-Keen-African user id gets the more informative error.
 */
export async function followUser(targetUserId: string, actor: AuthzActor) {
  if (targetUserId === actor.id) {
    throw new CannotFollowSelfError();
  }

  const target = await withRls({}, (tx) => tx.profile.findUnique({ where: { userId: targetUserId }, select: { userId: true } }));
  if (!target) {
    throw new FollowTargetNotFoundError();
  }

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.follow.findUnique({ where: { followerId_followingId: { followerId: actor.id, followingId: targetUserId } } })
  );
  if (existing) {
    throw new AlreadyFollowingError();
  }

  const follow = await withRls(actorRlsCtx(actor), (tx) =>
    tx.follow.create({ data: { followerId: actor.id, followingId: targetUserId } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "follow.created",
    entityType: "User",
    entityId: targetUserId,
    metadata: { followId: follow.id },
  });
  // See docs/NOTIFICATIONS.md's "Extension points" section — this is the
  // exact contract Session 39 reserved for this session. Never emitted by
  // unfollowUser() below: there is no "someone unfollowed you" signal, per
  // that same doc.
  emitDomainEvent("UserFollowed", { followerId: actor.id, followedUserId: targetUserId });

  return follow;
}

/**
 * Unfollow. Idempotent — calling this when not currently following is not
 * an error (the UI only ever offers "Unfollow" once already following, and
 * a double-click race resulting in a second no-op DELETE is not a failure
 * worth surfacing to the reader). Returns whether a row was actually
 * removed, so a caller that cares can still tell the difference.
 */
export async function unfollowUser(targetUserId: string, actor: AuthzActor): Promise<{ removed: boolean }> {
  const { count } = await withRls(actorRlsCtx(actor), (tx) =>
    tx.follow.deleteMany({ where: { followerId: actor.id, followingId: targetUserId } })
  );

  if (count > 0) {
    await recordAuditEvent({
      actorId: actor.id,
      action: "follow.removed",
      entityType: "User",
      entityId: targetUserId,
    });
  }

  return { removed: count > 0 };
}

// --- Public reads (no actor — anonymous, always allowed) -------------------
//
// Safe unauthenticated (withRls({})) because follows_select's RLS policy is
// unconditionally open (USING (true)) — follower/following counts and the
// relationship itself are public reputation signals, same "no draft/
// private state to protect" reasoning profiles_select already established.

export async function isFollowing(followerId: string | undefined | null, followingId: string): Promise<boolean> {
  if (!followerId) return false;
  const row = await withRls({}, (tx) =>
    tx.follow.findUnique({ where: { followerId_followingId: { followerId, followingId } }, select: { id: true } })
  );
  return row !== null;
}

export async function getFollowerCount(userId: string): Promise<number> {
  return withRls({}, (tx) => tx.follow.count({ where: { followingId: userId } }));
}

export async function getFollowingCount(userId: string): Promise<number> {
  return withRls({}, (tx) => tx.follow.count({ where: { followerId: userId } }));
}

export interface AuthorReputation {
  articleCount: number;
  totalViews: number;
  followerCount: number;
  followingCount: number;
}

/**
 * The reputation summary for the public profile page: published article
 * count, total views across those articles, follower/following counts.
 * Anonymous/public, same shape as every other read in this section —
 * article counts/views are already public on the article listing itself,
 * and follower counts are this table's own public fact.
 */
export async function getAuthorReputation(userId: string): Promise<AuthorReputation> {
  const [followerCount, followingCount, articleAgg] = await Promise.all([
    getFollowerCount(userId),
    getFollowingCount(userId),
    withRls({}, (tx) =>
      tx.article.aggregate({
        where: { authorId: userId, status: "published" },
        _count: { _all: true },
        _sum: { viewCount: true },
      })
    ),
  ]);

  return {
    articleCount: articleAgg._count._all,
    totalViews: articleAgg._sum.viewCount ?? 0,
    followerCount,
    followingCount,
  };
}
