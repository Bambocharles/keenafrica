"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createReport, ReportRateLimitedError, ReportTargetNotFoundError } from "@/lib/reports";

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Shared
 * by both public report entry points — the article page's and the profile
 * page's <ReportForm> — since the underlying contract (entityType,
 * entityId, a required reason, an optional signed-in reporter) is
 * identical for both. Works for a genuinely logged-out reader (this
 * session's explicit rule): auth() simply resolves to no session, and
 * createReport() accepts a null actor.
 */
export async function reportAction(formData: FormData) {
  const entityTypeRaw = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");

  if (entityTypeRaw !== "article" && entityTypeRaw !== "profile") {
    redirect(`${returnTo}?reportError=invalid`);
  }
  if (!reason.trim()) {
    redirect(`${returnTo}?reportError=reason_required`);
  }

  const session = await auth();
  const h = await headers();
  const ipAddress = h.get("x-forwarded-for");

  let error: string | null = null;
  try {
    await createReport({ entityType: entityTypeRaw, entityId, reason }, session?.user ?? null, ipAddress);
  } catch (err) {
    if (err instanceof ReportRateLimitedError) error = "rate_limited";
    else if (err instanceof ReportTargetNotFoundError) error = "not_found";
    else error = "failed";
  }

  redirect(error ? `${returnTo}?reportError=${error}` : `${returnTo}?reported=1`);
}
