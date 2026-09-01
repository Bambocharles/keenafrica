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
import { InvalidReportTransitionError, ReportNotFoundError, dismissReport, resolveReport } from "@/lib/reports";
import type { ProfileBadge } from "@prisma/client";
import { PROFILE_BADGES, setProfileBadge, setProfileFeatured } from "@/lib/profiles";
import { suspendUser, reinstateUser } from "@/lib/users";

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
  if (err instanceof ReportNotFoundError) return "report_not_found";
  if (err instanceof InvalidReportTransitionError) return "report_already_reviewed";
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

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Report
 * review actions — articles.manage is enforced inside resolveReport()/
 * dismissReport() themselves (and independently at the RLS layer — see
 * the keen_africans_reports migration), not just by this page being
 * reachable.
 */
export async function resolveReportAction(formData: FormData) {
  const actor = await requireActor();
  const reportId = String(formData.get("reportId") ?? "");
  const note = String(formData.get("note") ?? "");
  let error: string | null = null;
  try {
    await resolveReport(reportId, actor, note);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

export async function dismissReportAction(formData: FormData) {
  const actor = await requireActor();
  const reportId = String(formData.get("reportId") ?? "");
  const note = String(formData.get("note") ?? "");
  let error: string | null = null;
  try {
    await dismissReport(reportId, actor, note);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath("/keen-africans");
  if (error) redirect(`/keen-africans?error=${error}`);
}

/**
 * User-moderation actions for the Keen Africans console
 * (/keen-africans/users/[id]) — thin wrappers around the existing,
 * platform-wide src/lib/users.ts functions (users.suspend). No new
 * suspension mechanism: see that module's own comment — suspension
 * already revokes every session platform-wide, which is the confirmed,
 * intended effect here too (Keen Africa's canonical single User identity
 * has no portal-scoped suspension concept, and CLAUDE_BUILD_RULES.md §3
 * forbids inventing one).
 */
export async function suspendKeenAfricanAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  let error: string | null = null;
  try {
    await suspendUser(userId, actor, reason);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath(`/keen-africans/users/${userId}`);
  if (error) redirect(`/keen-africans/users/${userId}?error=${error}`);
}

export async function reinstateKeenAfricanAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  let error: string | null = null;
  try {
    await reinstateUser(userId, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath(`/keen-africans/users/${userId}`);
  if (error) redirect(`/keen-africans/users/${userId}?error=${error}`);
}

export async function setFeaturedAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  const featured = String(formData.get("featured") ?? "") === "true";
  let error: string | null = null;
  try {
    await setProfileFeatured(userId, featured, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath(`/keen-africans/users/${userId}`);
  if (error) redirect(`/keen-africans/users/${userId}?error=${error}`);
}

/**
 * Session 42 (Follow & Author Reputation Display). The "Top Contributor" /
 * "Community Mentor" editorial label — same thin-wrapper shape as
 * setFeaturedAction above. An empty/unrecognized `badge` value clears it
 * (the admin form's "None" option), same shape as setProfileBadge()'s own
 * `null` contract.
 */
export async function setBadgeAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  const raw = String(formData.get("badge") ?? "");
  const badge = (PROFILE_BADGES as readonly string[]).includes(raw) ? (raw as ProfileBadge) : null;

  let error: string | null = null;
  try {
    await setProfileBadge(userId, badge, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath(`/keen-africans/users/${userId}`);
  if (error) redirect(`/keen-africans/users/${userId}?error=${error}`);
}

/**
 * Grant/revoke VERIFIED directly from a specific account's admin detail
 * page — same approveVerification()/rejectVerification() functions the
 * pending-review queue above already uses (verification.review-gated,
 * same state-machine constraints: approve only from linkedin_connected,
 * reject/revoke from linkedin_connected or verified), just redirecting
 * back to the user detail page instead of the queue.
 */
export async function approveVerificationForUserAction(formData: FormData) {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  let error: string | null = null;
  try {
    await approveVerification(userId, actor);
  } catch (err) {
    error = toError(err);
  }
  revalidatePath(`/keen-africans/users/${userId}`);
  if (error) redirect(`/keen-africans/users/${userId}?error=${error}`);
}

export async function rejectVerificationForUserAction(formData: FormData) {
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
  revalidatePath(`/keen-africans/users/${userId}`);
  if (error) redirect(`/keen-africans/users/${userId}?error=${error}`);
}
