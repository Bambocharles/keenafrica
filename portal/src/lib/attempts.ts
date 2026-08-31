import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { actorRlsCtx, assertActiveEnrollment, requireCourseContentAccess } from "@/lib/courses";
import type { SnapshotQuestion } from "@/lib/assessments";

/**
 * Assessment (Session 07) — Attempt, Answer: the student-attempt/grading/
 * results half of the module (src/lib/assessments.ts owns authoring/
 * publish/assignment).
 *
 * Every attempt is permanently bound to ONE AssessmentVersion snapshot
 * (never the live, editable Assessment/Question rows) — see
 * assessments.ts's publishAssessment() docstring. Grading always reads the
 * snapshot's answer key, never live Question/QuestionOption rows, so a
 * teacher editing the bank after a student has attempted an assessment can
 * never change that attempt's outcome.
 *
 * Answer-key redaction while a question is still ungraded is an
 * APPLICATION-layer concern (buildAttemptView below) — RLS is a row-level
 * backstop, not column-level (see the migration's design note); a student
 * who owns the attempt IS permitted to SELECT the raw AssessmentVersion row
 * at the DB layer, but every function in this file that returns data to a
 * student strips isCorrect/acceptableAnswers for any question not yet
 * graded before returning.
 */

export interface SubmittedAnswerInput {
  questionId: string;
  selectedOptionIds?: string[];
  textResponse?: string;
}

function normalizeSet(ids: string[] | undefined): Set<string> {
  return new Set((ids ?? []).map((s) => s.trim()).filter(Boolean));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Grades one question against the snapshot's answer key. Returns null isCorrect when manual grading is required. */
function gradeAnswer(
  snapshotQuestion: SnapshotQuestion,
  input: SubmittedAnswerInput | undefined
): { isCorrect: boolean | null; awardedPoints: number | null } {
  if (snapshotQuestion.type === "single_choice" || snapshotQuestion.type === "multiple_choice") {
    const validOptionIds = new Set(snapshotQuestion.options.map((o) => o.id));
    const selected = normalizeSet(input?.selectedOptionIds);
    for (const id of selected) {
      if (!validOptionIds.has(id)) throw new Error("Invalid option selected for question " + snapshotQuestion.questionId);
    }
    const correct = new Set(snapshotQuestion.options.filter((o) => o.isCorrect).map((o) => o.id));
    const isCorrect = setsEqual(selected, correct);
    return { isCorrect, awardedPoints: isCorrect ? snapshotQuestion.points : 0 };
  }

  // short_answer
  const text = (input?.textResponse ?? "").trim();
  if (!text) return { isCorrect: false, awardedPoints: 0 };
  const acceptable = snapshotQuestion.acceptableAnswers ?? [];
  if (acceptable.length > 0) {
    const matched = acceptable.some((a) => a.trim().toLowerCase() === text.toLowerCase());
    if (matched) return { isCorrect: true, awardedPoints: snapshotQuestion.points };
    return { isCorrect: false, awardedPoints: 0 };
  }
  return { isCorrect: null, awardedPoints: null }; // requires manual grading
}

function scoreFromAnswers(snapshot: SnapshotQuestion[], answers: Map<string, { isCorrect: boolean | null; awardedPoints: number | null }>) {
  const allGraded = snapshot.every((q) => (answers.get(q.questionId)?.isCorrect ?? null) !== null);
  if (!allGraded) return { allGraded: false as const };

  const maxPoints = snapshot.reduce((sum, q) => sum + q.points, 0);
  const scorePoints = snapshot.reduce((sum, q) => sum + (answers.get(q.questionId)?.awardedPoints ?? 0), 0);
  const scorePercent = maxPoints > 0 ? (scorePoints / maxPoints) * 100 : 0;
  return { allGraded: true as const, maxPoints, scorePoints, scorePercent };
}

/** Shape returned to a student — one entry per snapshot question, answer-key fields present only once that question is individually graded. */
export interface AttemptQuestionView {
  questionId: string;
  order: number;
  points: number;
  type: SnapshotQuestion["type"];
  prompt: string;
  learningObjective: string;
  options: { id: string; text: string; order: number; isCorrect?: boolean }[];
  myAnswer: { selectedOptionIds: string[]; textResponse: string | null } | null;
  graded: boolean;
  isCorrect?: boolean;
  awardedPoints?: number;
  explanation?: string;
}

function buildAttemptView(
  snapshot: SnapshotQuestion[],
  answers: { questionId: string; selectedOptionIds: unknown; textResponse: string | null; isCorrect: boolean | null; awardedPoints: number | null }[],
  opts: { revealAll: boolean }
): AttemptQuestionView[] {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  return [...snapshot]
    .sort((a, b) => a.order - b.order)
    .map((q) => {
      const answer = byQuestion.get(q.questionId);
      const graded = opts.revealAll || (answer?.isCorrect ?? null) !== null;
      return {
        questionId: q.questionId,
        order: q.order,
        points: q.points,
        type: q.type,
        prompt: q.prompt,
        learningObjective: q.learningObjective,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          order: o.order,
          ...(graded ? { isCorrect: o.isCorrect } : {}),
        })),
        myAnswer: answer
          ? { selectedOptionIds: (answer.selectedOptionIds as string[] | null) ?? [], textResponse: answer.textResponse }
          : null,
        graded,
        ...(graded && answer
          ? { isCorrect: answer.isCorrect ?? undefined, awardedPoints: answer.awardedPoints ?? undefined, explanation: q.explanation }
          : {}),
      };
    });
}

// --- Start / resume ---------------------------------------------------

/**
 * Starts a new attempt, or resumes an existing in_progress one (idempotent
 * — never creates a second concurrent in_progress attempt). Requires an
 * active/completed enrollment in the assessment's course AND that the
 * assessment is actually assigned to this student (directly, or via a
 * cohort they're enrolled in) — the "authorized assessment" acceptance
 * criterion. Enforces maxAttempts.
 */
/**
 * Read-only: the actor's current in_progress attempt for this assessment,
 * or null. Deliberately does NOT create one — used by the "live attempt"
 * page so simply loading/refreshing it never burns an attempt; only the
 * explicit "Start/Resume" action (startAttempt()) does that.
 */
export async function getInProgressAttempt(assessmentId: string, actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findFirst({ where: { assessmentId, studentUserId: actor.id, status: "in_progress" } })
  );
}

export async function startAttempt(assessmentId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId } }));
  if (!assessment) throw new AuthorizationError("Assessment not found or not assigned to you");
  if (assessment.status !== "published") throw new AuthorizationError("Assessment is not published");

  await assertActiveEnrollment(assessment.courseId, actor);

  const assigned = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentAssignment.findFirst({
      where: {
        assessmentId,
        OR: [
          { studentUserId: actor.id },
          { cohort: { enrollments: { some: { studentUserId: actor.id, status: { in: ["active", "completed"] } } } } },
        ],
      },
    })
  );
  if (!assigned) throw new AuthorizationError("This assessment is not assigned to you");

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findMany({ where: { assessmentId, studentUserId: actor.id }, orderBy: { attemptNumber: "desc" } })
  );
  const inProgress = existing.find((a) => a.status === "in_progress");
  if (inProgress) return inProgress;

  if (assessment.maxAttempts != null && existing.length >= assessment.maxAttempts) {
    throw new AuthorizationError("Maximum attempts reached for this assessment");
  }

  const version = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentVersion.findFirst({ where: { assessmentId }, orderBy: { version: "desc" } })
  );
  if (!version) throw new Error("Assessment has no published version");

  const attempt = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.create({
      data: {
        assessmentId,
        assessmentVersionId: version.id,
        courseId: assessment.courseId,
        studentUserId: actor.id,
        attemptNumber: existing.length + 1,
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "attempt.started", entityType: "Attempt", entityId: attempt.id, metadata: { assessmentId } });

  return attempt;
}

/**
 * Self-scoped attempt + question view for the student currently taking (or
 * having taken) it. studentUserId is filtered explicitly at the application
 * layer, not left to RLS alone — same defense-in-depth reasoning as
 * notes.ts's updateNote()/deleteNote() (the local dev/test connection is
 * the Postgres superuser and always bypasses RLS).
 */
export async function getAttemptForStudent(attemptId: string, actor: AuthzActor) {
  const attempt = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findFirst({
      where: actor.isSuperAdmin ? { id: attemptId } : { id: attemptId, studentUserId: actor.id },
      include: { assessment: { include: { course: { select: { id: true, title: true } } } }, answers: true },
    })
  );
  if (!attempt) return null;

  const version = await withRls(actorRlsCtx(actor), (tx) => tx.assessmentVersion.findUniqueOrThrow({ where: { id: attempt.assessmentVersionId } }));
  const snapshot = version.questions as unknown as SnapshotQuestion[];
  const questions = buildAttemptView(snapshot, attempt.answers, { revealAll: false });

  return { attempt, versionTitle: version.title, versionInstructions: version.instructions, questions };
}

// --- Submit / auto-grade ---------------------------------------------------

/**
 * Submits answers for an in_progress attempt. Auto-grades single_choice/
 * multiple_choice against the snapshot's answer key, and short_answer
 * against acceptableAnswers when present; any short_answer question with no
 * match and no configured acceptableAnswers is left pending (isCorrect
 * null) for gradeAttempt(). If every question ends up graded immediately,
 * the attempt finalizes to status="graded" in the same call and
 * AssessmentGraded is emitted alongside AssessmentSubmitted.
 */
export async function submitAttempt(attemptId: string, answers: SubmittedAnswerInput[], actor: AuthzActor) {
  const attempt = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findFirst({ where: actor.isSuperAdmin ? { id: attemptId } : { id: attemptId, studentUserId: actor.id } })
  );
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.status !== "in_progress") throw new AuthorizationError("This attempt has already been submitted");

  const version = await withRls(actorRlsCtx(actor), (tx) => tx.assessmentVersion.findUniqueOrThrow({ where: { id: attempt.assessmentVersionId } }));
  const snapshot = version.questions as unknown as SnapshotQuestion[];
  const validQuestionIds = new Set(snapshot.map((q) => q.questionId));
  for (const a of answers) {
    if (!validQuestionIds.has(a.questionId)) throw new Error("Answer references a question not on this assessment version");
  }

  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const graded = new Map(snapshot.map((q) => [q.questionId, gradeAnswer(q, byQuestion.get(q.questionId))]));
  const score = scoreFromAnswers(snapshot, graded);

  const { passingScorePercent } = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessment.findUniqueOrThrow({ where: { id: attempt.assessmentId }, select: { passingScorePercent: true } })
  );

  await withRls(actorRlsCtx(actor), async (tx) => {
    for (const q of snapshot) {
      const input = byQuestion.get(q.questionId);
      const g = graded.get(q.questionId)!;
      await tx.answer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: q.questionId } },
        create: {
          attemptId,
          questionId: q.questionId,
          selectedOptionIds: input?.selectedOptionIds?.length ? input.selectedOptionIds : undefined,
          textResponse: input?.textResponse?.trim() || undefined,
          isCorrect: g.isCorrect,
          awardedPoints: g.awardedPoints,
        },
        update: {
          selectedOptionIds: input?.selectedOptionIds?.length ? input.selectedOptionIds : undefined,
          textResponse: input?.textResponse?.trim() || undefined,
          isCorrect: g.isCorrect,
          awardedPoints: g.awardedPoints,
        },
      });
    }

    await tx.attempt.update({
      where: { id: attemptId },
      data: {
        status: score.allGraded ? "graded" : "submitted",
        submittedAt: new Date(),
        ...(score.allGraded
          ? {
              scorePoints: score.scorePoints,
              maxPoints: score.maxPoints,
              scorePercent: score.scorePercent,
              passed: passingScorePercent != null ? score.scorePercent >= passingScorePercent : null,
              gradedAt: new Date(),
            }
          : {}),
      },
    });
  });

  await recordAuditEvent({ actorId: actor.id, action: "attempt.submitted", entityType: "Attempt", entityId: attemptId, metadata: { assessmentId: attempt.assessmentId } });
  emitDomainEvent("AssessmentSubmitted", { attemptId, studentId: attempt.studentUserId, assessmentId: attempt.assessmentId });

  if (score.allGraded) {
    await recordAuditEvent({ actorId: actor.id, action: "attempt.graded", entityType: "Attempt", entityId: attemptId, metadata: { auto: true } });
    emitDomainEvent("AssessmentGraded", { attemptId, studentId: attempt.studentUserId, assessmentId: attempt.assessmentId });
  }

  return getAttemptForStudent(attemptId, actor);
}

// --- Manual grading (teacher) ---------------------------------------------

export interface ManualGradeInput {
  questionId: string;
  isCorrect: boolean;
  awardedPoints: number;
}

/**
 * Teacher grading for pending (short-answer, no auto-match) questions on a
 * submitted attempt. Ownership-scoped like every other authoring action
 * (courses.content.write + cohort_teachers on the assessment's course).
 * Can be called incrementally; the attempt finalizes to status="graded"
 * (and AssessmentGraded fires) only once every question has a non-null
 * isCorrect.
 */
export async function gradeAttempt(attemptId: string, grades: ManualGradeInput[], actor: AuthzActor) {
  const attempt = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findUnique({ where: { id: attemptId }, include: { assessment: { select: { courseId: true, passingScorePercent: true } } } })
  );
  if (!attempt) throw new Error("Attempt not found");
  await requireCourseContentAccess(attempt.assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);
  if (attempt.status === "in_progress") throw new AuthorizationError("Cannot grade an attempt that hasn't been submitted yet");

  const version = await withRls(actorRlsCtx(actor), (tx) => tx.assessmentVersion.findUniqueOrThrow({ where: { id: attempt.assessmentVersionId } }));
  const snapshot = version.questions as unknown as SnapshotQuestion[];

  await withRls(actorRlsCtx(actor), async (tx) => {
    for (const g of grades) {
      await tx.answer.update({
        where: { attemptId_questionId: { attemptId, questionId: g.questionId } },
        data: { isCorrect: g.isCorrect, awardedPoints: g.awardedPoints },
      });
    }
  });

  const allAnswers = await withRls(actorRlsCtx(actor), (tx) => tx.answer.findMany({ where: { attemptId } }));
  const gradedMap = new Map(allAnswers.map((a) => [a.questionId, { isCorrect: a.isCorrect, awardedPoints: a.awardedPoints }]));
  const score = scoreFromAnswers(snapshot, gradedMap);

  if (score.allGraded) {
    await withRls(actorRlsCtx(actor), (tx) =>
      tx.attempt.update({
        where: { id: attemptId },
        data: {
          status: "graded",
          scorePoints: score.scorePoints,
          maxPoints: score.maxPoints,
          scorePercent: score.scorePercent,
          passed: attempt.assessment.passingScorePercent != null ? score.scorePercent >= attempt.assessment.passingScorePercent : null,
          gradedAt: new Date(),
          gradedBy: actor.id,
        },
      })
    );

    await recordAuditEvent({ actorId: actor.id, action: "attempt.graded", entityType: "Attempt", entityId: attemptId, metadata: { auto: false } });
    emitDomainEvent("AssessmentGraded", { attemptId, studentId: attempt.studentUserId, assessmentId: attempt.assessmentId });
  }

  return getAttemptForTeacher(attemptId, actor);
}

// --- Teacher-facing reads ---------------------------------------------

/** Requires courses.manage, super_admin, or being a teacher on the course. Full reveal — needed to grade. */
export async function getAttemptForTeacher(attemptId: string, actor: AuthzActor) {
  const attempt = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: { select: { id: true, courseId: true, title: true } },
        student: { select: { id: true, name: true, email: true } },
        answers: true,
      },
    })
  );
  if (!attempt) return null;
  await requireCourseContentAccess(attempt.assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const version = await withRls(actorRlsCtx(actor), (tx) => tx.assessmentVersion.findUniqueOrThrow({ where: { id: attempt.assessmentVersionId } }));
  const snapshot = version.questions as unknown as SnapshotQuestion[];
  const questions = buildAttemptView(snapshot, attempt.answers, { revealAll: true });

  return { attempt, versionTitle: version.title, versionInstructions: version.instructions, questions };
}

/** Requires courses.manage, super_admin, or being a teacher on the course — the grading queue / results roster. */
export async function listAttemptsForAssessment(assessmentId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findMany({
      where: { assessmentId },
      orderBy: [{ studentUserId: "asc" }, { attemptNumber: "asc" }],
      include: { student: { select: { id: true, name: true, email: true } } },
    })
  );
}

// --- Student results --------------------------------------------------

/** Self-scoped: every attempt the student has ever made, most recent first — no permission required beyond self-scoping (mirrors listMyEnrollments()). */
export async function listMyResults(actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findMany({
      where: { studentUserId: actor.id },
      orderBy: { startedAt: "desc" },
      include: { assessment: { include: { course: { select: { id: true, title: true } } } } },
    })
  );
}
