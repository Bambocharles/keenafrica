import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx } from "@/lib/courses";
import { countRecentAuditEvents } from "@/lib/rate-limit";
import { assertEmailVerified } from "@/lib/articles";

/**
 * Comments & Reactions (Session 43). A single reaction type ("like") on a
 * published Article — per this session's own explicit "a single reaction
 * type is enough — do not build a multi-emoji reaction system unless
 * asked" rule. One row per (article, user), toggled on/off — same
 * per-target-per-user uniqueness and self-service-only shape as Follow
 * (Session 42), see schema.prisma's ArticleReaction comment for why
 * "unreacting" is a real hard DELETE (unlike Comment's soft-delete).
 *
 * Same authorization gate as comments.ts (see that module's header for the
 * full reasoning): holding articles.write or being super_admin, PLUS the
 * exact same email-verification gate Session 34 built for publishing
 * (src/lib/articles.ts's assertEmailVerified()) — this session's own
 * "Only a logged-in, email-verified Keen African may comment or react"
 * rule, reused rather than duplicated.
 */

export class ReactionTargetNotFoundError extends Error {
  constructor(message = "That article could not be found, or isn't published") {
    super(message);
    this.name = "ReactionTargetNotFoundError";
  }
}

export class AlreadyReactedError extends Error {
  constructor(message = "You already reacted to this article") {
    super(message);
    this.name = "AlreadyReactedError";
  }
}

export class ReactionRateLimitedError extends Error {
  constructor(message = "Too many reactions submitted recently — try again later") {
    super(message);
    this.name = "ReactionRateLimitedError";
  }
}

/** Same "holding articles.write (or being super_admin) is this codebase's proxy for a registered, engaging Keen African" signal comments.ts's own assertMayEngage() uses. */
function assertMayEngage(actor: AuthzActor): void {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_WRITE)) {
    throw new AuthorizationError("Only Keen Africans may react");
  }
}

// --- Rate limiting (this session's explicit acceptance criterion) --------
//
// Reuses countRecentAuditEvents against reaction.created, same mechanism
// every other limiter in this codebase uses. More generous than comment
// creation — a reaction is a single click, not authored content — but
// still bounded: the per-(article,user) unique constraint alone stops
// re-liking the SAME article, not rapid reacting across many different
// ones.
export const REACTION_WINDOW = { windowMs: 60 * 60 * 1000, maxAttempts: 30 };

async function assertNotRateLimited(actorId: string): Promise<void> {
  const count = await countRecentAuditEvents({
    actions: ["reaction.created"],
    actorId,
    sinceMs: REACTION_WINDOW.windowMs,
  });
  if (count >= REACTION_WINDOW.maxAttempts) {
    throw new ReactionRateLimitedError();
  }
}

// --- Write (self-service, toggle) -----------------------------------------

export async function reactToArticle(articleId: string, actor: AuthzActor) {
  assertMayEngage(actor);
  await assertEmailVerified(actor);
  await assertNotRateLimited(actor.id);

  const article = await withRls({}, (tx) =>
    tx.article.findFirst({ where: { id: articleId, status: "published" }, select: { id: true } })
  );
  if (!article) throw new ReactionTargetNotFoundError();

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.articleReaction.findUnique({ where: { articleId_userId: { articleId, userId: actor.id } } })
  );
  if (existing) throw new AlreadyReactedError();

  const reaction = await withRls(actorRlsCtx(actor), (tx) =>
    tx.articleReaction.create({ data: { articleId, userId: actor.id } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "reaction.created",
    entityType: "Article",
    entityId: articleId,
    metadata: { reactionId: reaction.id },
  });

  return reaction;
}

/**
 * Idempotent — calling this when not currently reacted is not an error,
 * same reasoning as follows.ts's unfollowUser(). Returns whether a row was
 * actually removed.
 */
export async function unreactToArticle(articleId: string, actor: AuthzActor): Promise<{ removed: boolean }> {
  const { count } = await withRls(actorRlsCtx(actor), (tx) =>
    tx.articleReaction.deleteMany({ where: { articleId, userId: actor.id } })
  );

  if (count > 0) {
    await recordAuditEvent({ actorId: actor.id, action: "reaction.removed", entityType: "Article", entityId: articleId });
  }

  return { removed: count > 0 };
}

// --- Public reads (no actor — anonymous, always allowed) -------------------
//
// Safe unauthenticated (withRls({})) because article_reactions_select's
// RLS policy is unconditionally open (USING (true)) — same "public
// reputation signal" reasoning follows_select established.

export async function hasReacted(userId: string | undefined | null, articleId: string): Promise<boolean> {
  if (!userId) return false;
  const row = await withRls({}, (tx) =>
    tx.articleReaction.findUnique({ where: { articleId_userId: { articleId, userId } }, select: { id: true } })
  );
  return row !== null;
}

export async function getReactionCount(articleId: string): Promise<number> {
  return withRls({}, (tx) => tx.articleReaction.count({ where: { articleId } }));
}
