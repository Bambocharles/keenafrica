"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { submitAttempt, type SubmittedAnswerInput } from "@/lib/attempts";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function submitAttemptAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const attemptId = String(formData.get("attemptId") ?? "");
  const questionIds = formData.getAll("questionId").map(String);

  const answers: SubmittedAnswerInput[] = questionIds.map((questionId) => ({
    questionId,
    selectedOptionIds: formData.getAll(`selected_${questionId}`).map(String),
    textResponse: String(formData.get(`text_${questionId}`) ?? ""),
  }));

  try {
    await submitAttempt(attemptId, answers, actor);
  } catch (err) {
    const error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
    redirect(`/assessments/${assessmentId}/attempt?error=${error}`);
  }

  redirect(`/results/${attemptId}`);
}
