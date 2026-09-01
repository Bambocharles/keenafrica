import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx } from "@/lib/courses";
import { countRecentAuditEvents } from "@/lib/rate-limit";
import { resolveAuthorName } from "@/lib/profiles";
import { assertEmailVerified } from "@/lib/articles";

/**
 * Comments & Reactions (Session 43). A comment on a published Article.
 *
 * The ONE rule this session's brief calls out explicitly: no separate
 * content-rendering pipeline for comments. `body` is stored as plain
 * Markdown text, exactly like Article.body, and rendered by the SAME
 * exported src/lib/articles.ts function (renderArticleBodyHtml — marked ->
 * sanitize-html) every article body already goes through. This module
 * never parses or sanitizes HTML itself; the public article page calls
 * renderArticleBodyHtml(comment.body) for each comment the same way it
 * calls renderArticleBodyHtml(article.body) for the article itself. See
 * comments.test.ts for proof this actually strips the same XSS payloads
 * articles.test.ts already covers.
 *
 * Authorization mirrors createArticle()'s own "may this actor act as a
 * Keen African at all" check (holding articles.write, or super_admin —
 * NOT articles.manage alone, same asymmetry createArticle() itself has:
 * an ADMIN who isn't also a registered Keen African cannot author
 * content), PLUS src/lib/articles.ts's exported assertEmailVerified() —
 * the exact same email-verification gate Session 34 built for publishing,
 * reused here rather than reimplemented, per this session's own explicit
 * "reuse the same email-verification gate" rule.
 *
 * Deletion has three self-service tiers, per this session's own "Owns"
 * bullet: (1) a comment's own author deleting their own comment, (2) an
 * ARTICLE's own author moderating comments on their own article (the
 * "blog owner can remove a comment under their own post" pattern), and
 * (3) articles.manage/super_admin moderating anywhere. All three are
 * enforced in application code below AND independently at the RLS layer
 * (keen_africans_comments migration's comments_update policy) — the
 * standard this codebase's ownership checks meet everywhere else. It is
 * always a soft-delete (deletedAt/deletedBy) — see schema.prisma's
 * Comment comment for why a hard DELETE is never allowed.
 */

export class CommentTargetNotFoundError extends Error {
  constructor(message = "That article could not be found, or isn't published") {
    super(message);
    this.name = "CommentTargetNotFoundError";
  }
}

export class CommentNotFoundError extends Error {
  constructor(message = "Comment not found") {
    super(message);
    this.name = "CommentNotFoundError";
  }
}

export class CommentRateLimitedError extends Error {
  constructor(message = "Too many comments posted recently — try again later") {
    super(message);
    this.name = "CommentRateLimitedError";
  }
}

const MAX_COMMENT_LENGTH = 3000;

/** Same "holding articles.write (or being super_admin) is this codebase's proxy for a registered, engaging Keen African" signal createArticle() itself uses — see this module's header. */
function assertMayEngage(actor: AuthzActor): void {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_WRITE)) {
    throw new AuthorizationError("Only Keen Africans may comment");
  }
}

// --- Rate limiting (this session's explicit rule: reuse rate-limit.ts) ---
//
// Reuses countRecentAuditEvents against comment.created, same mechanism
// every other limiter in this codebase uses (article creation, reports,
// login) — no new limiter. More generous than article creation (comments
// are lower-stakes, higher-frequency engagement) but still bounded.
export const COMMENT_CREATE_WINDOW = { windowMs: 60 * 60 * 1000, maxAttempts: 20 };

async function assertNotRateLimited(actorId: string): Promise<void> {
  const count = await countRecentAuditEvents({
    actions: ["comment.created"],
    actorId,
    sinceMs: COMMENT_CREATE_WINDOW.windowMs,
  });
  if (count >= COMMENT_CREATE_WINDOW.maxAttempts) {
    throw new CommentRateLimitedError();
  }
}

// --- Create --------------------------------------------------------------

export async function createComment(articleId: string, body: string, actor: AuthzActor) {
  assertMayEngage(actor);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment body is required");

  await assertEmailVerified(actor);
  await assertNotRateLimited(actor.id);

  const article = await withRls({}, (tx) =>
    tx.article.findFirst({ where: { id: articleId, status: "published" }, select: { id: true } })
  );
  if (!article) throw new CommentTargetNotFoundError();

  // Snapshot, not a live join — same "stability over always-fresh"
  // trade-off as articles.ts's createArticle(). Resolved once, here, at
  // creation time only.
  const authorName = await resolveAuthorName(actor);

  const comment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.comment.create({
      data: { articleId, authorId: actor.id, authorName, body: trimmed.slice(0, MAX_COMMENT_LENGTH) },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "comment.created",
    entityType: "Comment",
    entityId: comment.id,
    metadata: { articleId },
  });

  return comment;
}

// --- Delete (three self-service tiers — see this module's header) --------

async function requireCommentDeletable(commentId: string, actor: AuthzActor) {
  const comment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.comment.findUnique({ where: { id: commentId }, include: { article: { select: { authorId: true } } } })
  );
  if (!comment || comment.deletedAt) throw new CommentNotFoundError();

  const isCommentAuthor = comment.authorId === actor.id;
  const isArticleAuthor = comment.article.authorId === actor.id;
  if (
    !actor.isSuperAdmin &&
    !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE) &&
    !isCommentAuthor &&
    !isArticleAuthor
  ) {
    throw new AuthorizationError("Not authorized");
  }

  return { comment, isCommentAuthor, isArticleAuthor };
}

export async function deleteComment(commentId: string, actor: AuthzActor) {
  const { comment, isCommentAuthor, isArticleAuthor } = await requireCommentDeletable(commentId, actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.comment.update({ where: { id: commentId }, data: { deletedAt: new Date(), deletedBy: actor.id } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: isCommentAuthor ? "comment.deleted" : "comment.removed_by_moderator",
    entityType: "Comment",
    entityId: commentId,
    metadata: {
      articleId: comment.articleId,
      authorId: comment.authorId,
      ...(isCommentAuthor ? {} : { moderatorRole: isArticleAuthor ? "article_author" : "platform_moderator" }),
    },
  });

  return updated;
}

// --- Public reads (no actor — anonymous, published-article threads only) -

/**
 * Every non-deleted comment on an article, oldest first — the actual
 * "hide deleted comments from the public thread" boundary (the row itself
 * is retained for Report history, see schema.prisma's Comment comment).
 * Safe unauthenticated (withRls({})) for the same reason
 * getPublicArticleBySlug() is: comments_select's RLS policy has an
 * unconditional "parent article is published" branch.
 */
export async function listCommentsForArticle(articleId: string) {
  return withRls({}, (tx) =>
    tx.comment.findMany({ where: { articleId, deletedAt: null }, orderBy: { createdAt: "asc" } })
  );
}
