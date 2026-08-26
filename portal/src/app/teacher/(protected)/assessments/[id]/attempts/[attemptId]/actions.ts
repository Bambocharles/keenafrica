"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { gradeAttempt } from "@/lib/attempts";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function gradeAttemptAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const attemptId = String(formData.get("attemptId") ?? "");
  const questionIds = formData.getAll("pendingQuestionId").map(String);

  const grades = questionIds.map((questionId) => ({
    questionId,
    isCorrect: formData.get(`isCorrect_${questionId}`) === "true",
    awardedPoints: Number(formData.get(`awardedPoints_${questionId}`) ?? "0") || 0,
  }));

  let error: string | null = null;
  try {
    await gradeAttempt(attemptId, grades, actor);
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
  }

  revalidatePath(`/assessments/${assessmentId}/attempts/${attemptId}`);
  if (error) redirect(`/assessments/${assessmentId}/attempts/${attemptId}?error=${error}`);
}
