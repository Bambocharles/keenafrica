"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import {
  addQuestionToAssessment,
  archiveAssessment,
  assignAssessmentToCohort,
  assignAssessmentToStudent,
  publishAssessment,
  removeQuestionFromAssessment,
  reorderAssessmentQuestions,
  unassignAssessment,
  updateAssessment,
  getAssessmentById,
} from "@/lib/assessments";
import { createQuestion, type QuestionType } from "@/lib/questions";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

async function finish(assessmentId: string, error: string | null) {
  revalidatePath(`/assessments/${assessmentId}`);
  if (error) redirect(`/assessments/${assessmentId}?error=${error}`);
}

export async function updateAssessmentAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const instructions = String(formData.get("instructions") ?? "");
  const timeLimitMinutesRaw = String(formData.get("timeLimitMinutes") ?? "").trim();
  const maxAttemptsRaw = String(formData.get("maxAttempts") ?? "").trim();
  const passingScorePercentRaw = String(formData.get("passingScorePercent") ?? "").trim();

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await updateAssessment(
        assessmentId,
        {
          title,
          instructions,
          timeLimitMinutes: timeLimitMinutesRaw ? Number(timeLimitMinutesRaw) : null,
          maxAttempts: maxAttemptsRaw ? Number(maxAttemptsRaw) : null,
          passingScorePercent: passingScorePercentRaw ? Number(passingScorePercentRaw) : null,
        },
        actor
      );
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(assessmentId, error);
}

export async function publishAssessmentAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");

  let error: string | null = null;
  try {
    await publishAssessment(assessmentId, actor);
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "action_failed";
  }
  await finish(assessmentId, error);
}

export async function archiveAssessmentAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");

  let error: string | null = null;
  try {
    await archiveAssessment(assessmentId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(assessmentId, error);
}

const CHOICE_OPTION_SLOTS = 4;

export async function createAndAddQuestionAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const type = String(formData.get("type") ?? "") as QuestionType;
  const prompt = String(formData.get("prompt") ?? "").trim();
  const explanation = String(formData.get("explanation") ?? "").trim();
  const difficulty = String(formData.get("difficulty") ?? "medium") as "easy" | "medium" | "hard";
  const learningObjective = String(formData.get("learningObjective") ?? "").trim();
  const points = Number(formData.get("points") ?? "1") || 1;

  const options: { text: string; isCorrect: boolean }[] = [];
  for (let i = 0; i < CHOICE_OPTION_SLOTS; i++) {
    const text = String(formData.get(`optionText${i}`) ?? "").trim();
    if (!text) continue;
    options.push({ text, isCorrect: formData.get(`optionCorrect${i}`) === "on" });
  }
  const acceptableAnswersRaw = String(formData.get("acceptableAnswers") ?? "").trim();
  const acceptableAnswers = acceptableAnswersRaw
    ? acceptableAnswersRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  let error: string | null = null;
  if (!prompt || !type) {
    error = "missing_fields";
  } else {
    try {
      const question = await createQuestion(
        courseId,
        {
          type,
          prompt,
          explanation,
          difficulty,
          learningObjective,
          options: type === "short_answer" ? undefined : options,
          acceptableAnswers: type === "short_answer" ? acceptableAnswers : undefined,
        },
        actor
      );
      await addQuestionToAssessment(assessmentId, question.id, { points }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(assessmentId, error);
}

export async function addExistingQuestionAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const points = Number(formData.get("points") ?? "1") || 1;

  let error: string | null = null;
  if (!questionId) {
    error = "missing_fields";
  } else {
    try {
      await addQuestionToAssessment(assessmentId, questionId, { points }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(assessmentId, error);
}

export async function removeQuestionAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");

  let error: string | null = null;
  try {
    await removeQuestionFromAssessment(assessmentId, questionId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(assessmentId, error);
}

/** Swaps a question with its immediate predecessor/successor in display order. */
export async function moveQuestionAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  let error: string | null = null;
  try {
    const assessment = await getAssessmentById(assessmentId, actor);
    const ids = (assessment?.questions ?? []).map((aq) => aq.questionId);
    const idx = ids.indexOf(questionId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx >= 0 && swapWith >= 0 && swapWith < ids.length) {
      [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
      await reorderAssessmentQuestions(assessmentId, ids, actor);
    }
  } catch (err) {
    error = toError(err);
  }
  await finish(assessmentId, error);
}

export async function assignToCohortAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const cohortId = String(formData.get("cohortId") ?? "");
  const dueAtRaw = String(formData.get("dueAt") ?? "").trim();

  let error: string | null = null;
  if (!cohortId) {
    error = "missing_fields";
  } else {
    try {
      await assignAssessmentToCohort(assessmentId, cohortId, { dueAt: dueAtRaw ? new Date(dueAtRaw) : undefined }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(assessmentId, error);
}

export async function assignToStudentAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const studentUserId = String(formData.get("studentUserId") ?? "");
  const dueAtRaw = String(formData.get("dueAt") ?? "").trim();

  let error: string | null = null;
  if (!studentUserId) {
    error = "missing_fields";
  } else {
    try {
      await assignAssessmentToStudent(assessmentId, studentUserId, { dueAt: dueAtRaw ? new Date(dueAtRaw) : undefined }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(assessmentId, error);
}

export async function unassignAction(formData: FormData) {
  const actor = await requireActor();
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");

  let error: string | null = null;
  try {
    await unassignAssessment(assignmentId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(assessmentId, error);
}
