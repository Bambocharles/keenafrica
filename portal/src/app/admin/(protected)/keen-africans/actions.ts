"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import {
  InvalidReviewTransitionError,
  adminUnpublishArticle,
  approveArticle,
  rejectArticle,
  requestChanges,
} from "@/lib/articles";
import { VerificationNotFoundError, VerificationStateError, approveVerification, rejectVerification } from "@/lib/verification";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  if (err instanceof AuthorizationError) return "not_authorized";
  if (err instanceof InvalidReviewTransitionError) return "invalid_review_transition";
  if (err instanceof VerificationNotFoundError) return "verification_not_found";
  if (err instanceof VerificationStateError) return "invalid_verification_transition";
  return "action_failed";
}

export async function adminUnpublishArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  let error: string | null = null;
  if (!reason) {
    error = "reason_required";
  } else {
    try {
      await adminUnpublishArticle(articleId, actor, reason);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

export async function approveArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  let error: string | null = null;
  try {
    await approveArticle(articleId, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

export async function requestChangesAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  let error: string | null = null;
  if (!note) {
    error = "note_required";
  } else {
    try {
      await requestChanges(articleId, note, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

export async function rejectArticleAction(formData: FormData) {
  const actor = await requireActor();
  const articleId = String(formData.get("articleId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  let error: string | null = null;
  if (!reason) {
    error = "reason_required";
  } else {
    try {
      await rejectArticle(articleId, reason, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

/**
 * Session 40 (Keen Africans — LinkedIn Verification). The minimal
 * reviewer-queue actions this session's brief asks for ("build a minimal
 * one and hand it off" — Session 41 hadn't shipped its own moderation
 * console as of this session). Same shape as the article-review actions
 * above: verification.review is enforced inside approveVerification()/
 * rejectVerification() themselves (and independently at the RLS layer —
 * see the keen_africans_verification migration), not just by this page
 * being reachable.
 */
export async function approveVerificationAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  let error: string | null = null;
  try {
    await approveVerification(userId, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

export async function rejectVerificationAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  let error: string | null = null;
  if (!reason) {
    error = "verification_reason_required";
  } else {
    try {
      await rejectVerification(userId, actor, reason);
    } catch (err) {
      error = toError(err);
    }
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}
