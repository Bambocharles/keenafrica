"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { createAssessment } from "@/lib/assessments";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

export async function createAssessmentAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  if (!courseId || !title) redirect("/assessments?error=missing_fields");

  let newAssessmentId: string;
  try {
    newAssessmentId = (await createAssessment(courseId, { title }, actor)).id;
  } catch (err) {
    redirect(`/assessments?error=${toError(err)}`);
  }
  redirect(`/assessments/${newAssessmentId}`);
}
