"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { resolveClientIp } from "@/lib/client-ip";
import { EmailNotVerifiedError } from "@/lib/articles";
import { createReport, ReportRateLimitedError, ReportTargetNotFoundError } from "@/lib/reports";
import { AlreadyFollowingError, CannotFollowSelfError, FollowTargetNotFoundError, followUser, unfollowUser } from "@/lib/follows";
import {
  CommentNotFoundError,
  CommentRateLimitedError,
  CommentTargetNotFoundError,
  createComment,
  deleteComment,
} from "@/lib/comments";
import {
  AlreadyReactedError,
  ReactionRateLimitedError,
  ReactionTargetNotFoundError,
  reactToArticle,
  unreactToArticle,
} from "@/lib/reactions";

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Shared
 * by every public report entry point — the article page's own
 * <ReportForm>, the profile page's, and (Session 43) one per comment in
 * the article's comment thread — since the underlying contract
 * (entityType, entityId, a required reason, an optional signed-in
 * reporter) is identical for all three. Works for a genuinely logged-out
 * reader (this session's explicit rule): auth() simply resolves to no
 * session, and createReport() accepts a null actor.
 *
 * The success/error redirect echoes `entityId` back
 * (reportedEntityId/reportErrorEntityId) — Session 43 added this so a page
 * with MULTIPLE <ReportForm>s (the article's own, plus one per comment)
 * shows the "thanks" confirmation only on the ONE form the reader actually
 * submitted, not on every report widget on the page.
 */
export async function reportAction(formData: FormData) {
  const entityTypeRaw = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");

  if (entityTypeRaw !== "article" && entityTypeRaw !== "profile" && entityTypeRaw !== "comment") {
    redirect(`${returnTo}?reportError=invalid`);
  }
  if (!reason.trim()) {
    redirect(`${returnTo}?reportError=reason_required&reportErrorEntityId=${entityId}`);
  }

  const session = await auth();
  const h = await headers();
  const ipAddress = resolveClientIp(h);

  let error: string | null = null;
  try {
    await createReport({ entityType: entityTypeRaw, entityId, reason }, session?.user ?? null, ipAddress);
  } catch (err) {
    if (err instanceof ReportRateLimitedError) error = "rate_limited";
    else if (err instanceof ReportTargetNotFoundError) error = "not_found";
    else error = "failed";
  }

  redirect(
    error
      ? `${returnTo}?reportError=${error}&reportErrorEntityId=${entityId}`
      : `${returnTo}?reported=1&reportedEntityId=${entityId}`
  );
}

/**
 * Session 43 (Comments & Reactions). Requires a real session — commenting,
 * unlike reporting, is never anonymous (this session's own explicit rule).
 * createComment() itself enforces the "logged-in, email-verified Keen
 * African" gate server-side; this action only translates its typed errors
 * into a query-param the page can render.
 */
export async function commentAction(formData: FormData) {
  const session = await auth();
  const articleId = String(formData.get("articleId") ?? "");
  const body = String(formData.get("body") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  if (!session?.user) redirect("/login");

  let error: string | null = null;
  try {
    await createComment(articleId, body, session.user);
  } catch (err) {
    if (err instanceof CommentRateLimitedError) error = "rate_limited";
    else if (err instanceof EmailNotVerifiedError) error = "verify_email";
    else if (err instanceof AuthorizationError) error = "not_authorized";
    else if (err instanceof CommentTargetNotFoundError) error = "not_found";
    else if (err instanceof Error && err.message === "Comment body is required") error = "empty";
    else error = "failed";
  }

  redirect(error ? `${returnTo}?commentError=${error}` : `${returnTo}?commented=1`);
}

/** Session 43 (Comments & Reactions). One shared action for all three self-service delete tiers (comment author, article author, articles.manage) — deleteComment() itself resolves which one applies. */
export async function deleteCommentAction(formData: FormData) {
  const session = await auth();
  const commentId = String(formData.get("commentId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  if (!session?.user) redirect("/login");

  let error: string | null = null;
  try {
    await deleteComment(commentId, session.user);
  } catch (err) {
    if (err instanceof CommentNotFoundError) error = "not_found";
    else if (err instanceof AuthorizationError) error = "not_authorized";
    else error = "failed";
  }

  redirect(error ? `${returnTo}?commentDeleteError=${error}` : returnTo);
}

/** Session 43 (Comments & Reactions). Requires a real session, same reasoning as commentAction above. Treats AlreadyReactedError as a no-op success — a double-click race landing here isn't a failure worth surfacing. */
export async function reactAction(formData: FormData) {
  const session = await auth();
  const articleId = String(formData.get("articleId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  if (!session?.user) redirect("/login");

  let error: string | null = null;
  try {
    await reactToArticle(articleId, session.user);
  } catch (err) {
    if (err instanceof AlreadyReactedError) error = null;
    else if (err instanceof ReactionRateLimitedError) error = "rate_limited";
    else if (err instanceof EmailNotVerifiedError) error = "verify_email";
    else if (err instanceof AuthorizationError) error = "not_authorized";
    else if (err instanceof ReactionTargetNotFoundError) error = "not_found";
    else error = "failed";
  }

  redirect(error ? `${returnTo}?reactionError=${error}` : returnTo);
}

/** Idempotent, same reasoning as follows.ts's unfollowUser() — see that function's own comment. */
export async function unreactAction(formData: FormData) {
  const session = await auth();
  const articleId = String(formData.get("articleId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  if (!session?.user) redirect("/login");

  let error: string | null = null;
  try {
    await unreactToArticle(articleId, session.user);
  } catch {
    error = "failed";
  }

  redirect(error ? `${returnTo}?reactionError=${error}` : returnTo);
}

/**
 * Session 42 (Follow & Author Reputation Display). Shared by both follow
 * entry points — the public profile page's <FollowButton> and the article
 * byline's — same "one contract, both call sites" shape as reportAction
 * above. Requires a real session (unlike reportAction — following, unlike
 * reporting, is never anonymous); FollowButton itself only ever renders
 * the signed-in form when a session exists, so reaching here signed out
 * means a crafted/stale request, not a real user flow — redirecting to
 * /login is the correct, if defensive, response.
 */
export async function followAction(formData: FormData) {
  const session = await auth();
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  if (!session?.user) redirect("/login");

  let error: string | null = null;
  try {
    await followUser(targetUserId, session.user);
  } catch (err) {
    if (err instanceof CannotFollowSelfError) error = "cannot_follow_self";
    else if (err instanceof AlreadyFollowingError) error = "already_following";
    else if (err instanceof FollowTargetNotFoundError) error = "not_found";
    else error = "failed";
  }

  redirect(error ? `${returnTo}?followError=${error}` : returnTo);
}

export async function unfollowAction(formData: FormData) {
  const session = await auth();
  const targetUserId = String(formData.get("targetUserId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  if (!session?.user) redirect("/login");

  let error: string | null = null;
  try {
    await unfollowUser(targetUserId, session.user);
  } catch {
    error = "failed";
  }

  redirect(error ? `${returnTo}?followError=${error}` : returnTo);
}
