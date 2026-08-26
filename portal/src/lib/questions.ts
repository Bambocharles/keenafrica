import { Prisma } from "@prisma/client";
import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx, isCourseTeacher, requireCourseContentAccess } from "@/lib/courses";

/**
 * Read access mirrors content.ts's requireCourseContentAccessRead: either
 * content permission (write OR publish) is enough to browse the bank —
 * e.g. a publish-only holder assigning an assessment still needs to see
 * which questions exist.
 */
async function requireQuestionBankReadAccess(courseId: string, actor: AuthzActor): Promise<void> {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.COURSES_MANAGE)) return;
  if (!hasPermission(actor, PERMISSIONS.COURSES_CONTENT_WRITE) && !hasPermission(actor, PERMISSIONS.COURSES_CONTENT_PUBLISH)) {
    throw new AuthorizationError("Not authorized");
  }
  if (!(await isCourseTeacher(courseId, actor))) {
    throw new AuthorizationError("Not assigned to teach this course");
  }
}

/**
 * Assessment (Session 07) — the question bank. Course-scoped, reusable
 * across assessments (see src/lib/assessments.ts's AssessmentQuestion join).
 * Ownership-scoped exactly like Module/Lesson (src/lib/content.ts): no new
 * permission keys, reuses courses.content.write/courses.content.publish +
 * cohort_teachers via requireCourseContentAccess().
 *
 * Never hard-deleted (CLAUDE_BUILD_RULES.md §4/§10) — a question used in a
 * past AssessmentVersion snapshot must always resolve for topic-analysis/
 * reporting joins, so removal is archiveQuestion() (archived_at), not a
 * delete. Options ARE hard-deletable while iterating a draft question — the
 * true "never rewrite history" guarantee comes from AssessmentVersion's
 * immutable JSON snapshot (src/lib/assessments.ts's publishAssessment()),
 * not from freezing every live bank row forever.
 */

export type QuestionType = "single_choice" | "multiple_choice" | "short_answer";
export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface QuestionOptionInput {
  text: string;
  isCorrect: boolean;
}

export interface CreateQuestionInput {
  type: QuestionType;
  prompt: string;
  explanation?: string;
  difficulty?: QuestionDifficulty;
  learningObjective?: string;
  /** single_choice/multiple_choice only. */
  options?: QuestionOptionInput[];
  /** short_answer only — case-insensitive exact-match auto-grade candidates. */
  acceptableAnswers?: string[];
}

function validateQuestionShape(input: Pick<CreateQuestionInput, "type" | "options" | "acceptableAnswers">) {
  if (input.type === "single_choice" || input.type === "multiple_choice") {
    const options = input.options ?? [];
    if (options.length < 2) throw new Error("Choice questions need at least 2 options");
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (correctCount === 0) throw new Error("At least one option must be marked correct");
    if (input.type === "single_choice" && correctCount > 1) {
      throw new Error("single_choice questions must have exactly one correct option");
    }
  }
}

export async function createQuestion(courseId: string, input: CreateQuestionInput, actor: AuthzActor) {
  await requireCourseContentAccess(courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);
  validateQuestionShape(input);

  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Question prompt is required");

  const question = await withRls(actorRlsCtx(actor), (tx) =>
    tx.question.create({
      data: {
        courseId,
        type: input.type,
        prompt,
        explanation: input.explanation?.trim() ?? "",
        difficulty: input.difficulty ?? "medium",
        learningObjective: input.learningObjective?.trim() ?? "",
        acceptableAnswers: input.acceptableAnswers?.length ? input.acceptableAnswers : undefined,
        createdBy: actor.id,
        options: input.options?.length
          ? { create: input.options.map((o, i) => ({ text: o.text.trim(), isCorrect: o.isCorrect, order: i })) }
          : undefined,
      },
      include: { options: { orderBy: { order: "asc" } } },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "question.created", entityType: "Question", entityId: question.id, metadata: { courseId } });

  return question;
}

export interface UpdateQuestionInput {
  prompt?: string;
  explanation?: string;
  difficulty?: QuestionDifficulty;
  learningObjective?: string;
  acceptableAnswers?: string[] | null;
  /** When provided, replaces the full option set. */
  options?: QuestionOptionInput[];
}

export async function updateQuestion(questionId: string, data: UpdateQuestionInput, actor: AuthzActor) {
  const question = await withRls(actorRlsCtx(actor), (tx) =>
    tx.question.findUnique({ where: { id: questionId }, select: { courseId: true, type: true } })
  );
  if (!question) throw new Error("Question not found");
  await requireCourseContentAccess(question.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  if (data.options) validateQuestionShape({ type: question.type, options: data.options });

  return withRls(actorRlsCtx(actor), async (tx) => {
    if (data.options) {
      await tx.questionOption.deleteMany({ where: { questionId } });
      await tx.questionOption.createMany({
        data: data.options.map((o, i) => ({ questionId, text: o.text.trim(), isCorrect: o.isCorrect, order: i })),
      });
    }
    return tx.question.update({
      where: { id: questionId },
      data: {
        prompt: data.prompt?.trim(),
        explanation: data.explanation?.trim(),
        difficulty: data.difficulty,
        learningObjective: data.learningObjective?.trim(),
        acceptableAnswers:
          data.acceptableAnswers === undefined
            ? undefined
            : data.acceptableAnswers?.length
              ? data.acceptableAnswers
              : Prisma.DbNull,
      },
      include: { options: { orderBy: { order: "asc" } } },
    });
  });
}

/** Soft-archive — never a hard delete (see module docstring). Idempotent. */
export async function archiveQuestion(questionId: string, actor: AuthzActor) {
  const question = await withRls(actorRlsCtx(actor), (tx) => tx.question.findUnique({ where: { id: questionId }, select: { courseId: true } }));
  if (!question) throw new Error("Question not found");
  await requireCourseContentAccess(question.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) => tx.question.update({ where: { id: questionId }, data: { archivedAt: new Date() } }));
  await recordAuditEvent({ actorId: actor.id, action: "question.archived", entityType: "Question", entityId: questionId });
}

export async function unarchiveQuestion(questionId: string, actor: AuthzActor) {
  const question = await withRls(actorRlsCtx(actor), (tx) => tx.question.findUnique({ where: { id: questionId }, select: { courseId: true } }));
  if (!question) throw new Error("Question not found");
  await requireCourseContentAccess(question.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) => tx.question.update({ where: { id: questionId }, data: { archivedAt: null } }));
}

export interface ListQuestionBankFilter {
  includeArchived?: boolean;
  type?: QuestionType;
  difficulty?: QuestionDifficulty;
  topicId?: string;
}

/** Requires courses.manage, super_admin, or being a teacher on the course. */
export async function listQuestionBank(courseId: string, filter: ListQuestionBankFilter, actor: AuthzActor) {
  await requireQuestionBankReadAccess(courseId, actor);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.question.findMany({
      where: {
        courseId,
        archivedAt: filter.includeArchived ? undefined : null,
        type: filter.type,
        difficulty: filter.difficulty,
        topics: filter.topicId ? { some: { topicId: filter.topicId } } : undefined,
      },
      orderBy: { createdAt: "desc" },
      include: { options: { orderBy: { order: "asc" } }, topics: { include: { topic: true } } },
    })
  );
}

export async function getQuestionById(questionId: string, actor: AuthzActor) {
  const question = await withRls(actorRlsCtx(actor), (tx) =>
    tx.question.findUnique({ where: { id: questionId }, include: { options: { orderBy: { order: "asc" } }, topics: { include: { topic: true } } } })
  );
  if (!question) return null;
  await requireQuestionBankReadAccess(question.courseId, actor);
  return question;
}

// --- Topic tagging — same shape as tagLesson/untagLesson (src/lib/topics.ts) ---

export async function tagQuestion(questionId: string, topicId: string, actor: AuthzActor) {
  const question = await withRls(actorRlsCtx(actor), (tx) => tx.question.findUnique({ where: { id: questionId }, select: { courseId: true } }));
  if (!question) throw new Error("Question not found");
  await requireCourseContentAccess(question.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.questionTopic.upsert({
      where: { questionId_topicId: { questionId, topicId } },
      create: { questionId, topicId },
      update: {},
    })
  );
}

export async function untagQuestion(questionId: string, topicId: string, actor: AuthzActor) {
  const question = await withRls(actorRlsCtx(actor), (tx) => tx.question.findUnique({ where: { id: questionId }, select: { courseId: true } }));
  if (!question) throw new Error("Question not found");
  await requireCourseContentAccess(question.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) => tx.questionTopic.deleteMany({ where: { questionId, topicId } }));
}
