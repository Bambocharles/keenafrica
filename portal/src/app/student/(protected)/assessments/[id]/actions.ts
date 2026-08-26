"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { startAttempt } from "@/lib/attempts";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function startAttemptAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");

  try {
    await startAttempt(assessmentId, actor);
  } catch (err) {
    const error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
    redirect(`/assessments/${assessmentId}?error=${error}`);
  }

  redirect(`/assessments/${assessmentId}/attempt`);
}
