import { prisma } from "@/lib/db";
import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx, isCourseTeacher, requireCourseContentAccess } from "@/lib/courses";

/**
 * Assessment (Session 07) — Assessment, AssessmentQuestion (bank link),
 * AssessmentVersion (immutable publish snapshot), AssessmentAssignment
 * (cohort/student assignment). Ownership-scoped exactly like Module/Lesson
 * (src/lib/content.ts): no new permission keys.
 *
 * Workflow: create -> draft (edit question list) -> publish (snapshots into
 * a new AssessmentVersion, bumps version) -> assign (to a cohort or a
 * student) -> [student attempts — src/lib/attempts.ts] -> results.
 *
 * Re-publishing after editing the live question list creates ANOTHER
 * AssessmentVersion row; the previous one is never touched. Every Attempt
 * (src/lib/attempts.ts) is permanently bound to the specific version it
 * started against, so editing/republishing an assessment can never rewrite
 * what an already-attempted version asked or how it was graded — the
 * acceptance-criteria requirement this session must satisfy.
 */

async function requireAssessmentReadAccess(courseId: string, actor: AuthzActor): Promise<void> {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.COURSES_MANAGE)) return;
  if (!hasPermission(actor, PERMISSIONS.COURSES_CONTENT_WRITE) && !hasPermission(actor, PERMISSIONS.COURSES_CONTENT_PUBLISH)) {
    throw new AuthorizationError("Not authorized");
  }
  if (!(await isCourseTeacher(courseId, actor))) {
    throw new AuthorizationError("Not assigned to teach this course");
  }
}

// --- Assessment -------------------------------------------------------

export interface CreateAssessmentInput {
  title: string;
  instructions?: string;
  timeLimitMinutes?: number;
  maxAttempts?: number;
  passingScorePercent?: number;
}

export async function createAssessment(courseId: string, input: CreateAssessmentInput, actor: AuthzActor) {
  await requireCourseContentAccess(courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const title = input.title.trim();
  if (!title) throw new Error("Assessment title is required");

  const assessment = await withRls(actorRlsCtx(actor), async (tx) => {
    // Organization-Aware Education (Session 21): organizationId is
    // denormalized from the course at creation, immutable once set.
    const course = await tx.course.findUniqueOrThrow({ where: { id: courseId }, select: { organizationId: true } });
    return tx.assessment.create({
      data: {
        courseId,
        organizationId: course.organizationId,
        title,
        instructions: input.instructions?.trim() ?? "",
        timeLimitMinutes: input.timeLimitMinutes,
        maxAttempts: input.maxAttempts,
        passingScorePercent: input.passingScorePercent,
        createdBy: actor.id,
      },
    });
  });

  await recordAuditEvent({ actorId: actor.id, action: "assessment.created", entityType: "Assessment", entityId: assessment.id, metadata: { courseId } });

  return assessment;
}

export interface UpdateAssessmentInput {
  title?: string;
  instructions?: string;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  passingScorePercent?: number | null;
}

export async function updateAssessment(assessmentId: string, data: UpdateAssessmentInput, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.assessment.update({
      where: { id: assessmentId },
      data: {
        title: data.title?.trim(),
        instructions: data.instructions?.trim(),
        timeLimitMinutes: data.timeLimitMinutes,
        maxAttempts: data.maxAttempts,
        passingScorePercent: data.passingScorePercent,
      },
    })
  );
}

/** Draft/published -> archived. Existing attempts remain fully readable; no new attempts can start. */
export async function archiveAssessment(assessmentId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) => tx.assessment.update({ where: { id: assessmentId }, data: { status: "archived" } }));
  await recordAuditEvent({ actorId: actor.id, action: "assessment.archived", entityType: "Assessment", entityId: assessmentId });
}

/**
 * Requires courses.manage, super_admin, or being a teacher on the course —
 * includes draft assessments.
 *
 * Session 31 (P0 root cause): this used to be a single findMany with
 * `include: { _count: { select: { questions, attempts, assignments } } } }`.
 * Prisma implements a relation `_count` as a LEFT JOIN to an UNFILTERED
 * "WHERE 1=1 GROUP BY assessment_id" subquery over the ENTIRE questions/
 * attempts/assignments tables — it does not push this query's own
 * `courseId` filter into those subqueries. Because those tables' RLS
 * policies (assessment_core migration) contain EXISTS clauses that
 * reference assessments/assessment_assignments/cohorts, which reference
 * each other in turn, Postgres has to re-evaluate that whole nested policy
 * chain for every row in questions/attempts/assignments PLATFORM-WIDE, not
 * just this course's rows — confirmed via EXPLAIN against the real
 * portal_rls_test role (see status/project-status.md's Session 31
 * handoff). That combinatorial per-row cost, accumulated across many
 * sessions' worth of real attempts/assignments rows, is what actually
 * produced the ~18-28s query time that exceeded Prisma's 5s interactive
 * transaction timeout (P2028) — not a lock, not a missing index.
 *
 * Fix: fetch the course's (already small, already RLS-filtered)
 * assessment ids first, then compute each count via a separate `groupBy`
 * explicitly filtered to those ids. Same RLS policies, same visible
 * counts, same authorization — just bounded to this course's own rows
 * instead of the whole platform.
 */
export async function listAssessmentsForCourse(courseId: string, actor: AuthzActor) {
  await requireAssessmentReadAccess(courseId, actor);
  return withRls(actorRlsCtx(actor), async (tx) => {
    const assessments = await tx.assessment.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
    });
    const ids = assessments.map((a) => a.id);
    const [questionCounts, attemptCounts, assignmentCounts] = ids.length
      ? await Promise.all([
          tx.assessmentQuestion.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: ids } }, _count: { _all: true } }),
          tx.attempt.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: ids } }, _count: { _all: true } }),
          tx.assessmentAssignment.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: ids } }, _count: { _all: true } }),
        ])
      : [[], [], []];
    const toMap = (rows: { assessmentId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.assessmentId, r._count._all]));
    const questionsMap = toMap(questionCounts);
    const attemptsMap = toMap(attemptCounts);
    const assignmentsMap = toMap(assignmentCounts);
    return assessments.map((a) => ({
      ...a,
      _count: {
        questions: questionsMap.get(a.id) ?? 0,
        attempts: attemptsMap.get(a.id) ?? 0,
        assignments: assignmentsMap.get(a.id) ?? 0,
      },
    }));
  });
}

export async function getAssessmentById(assessmentId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessment.findUnique({
      where: { id: assessmentId },
      include: {
        questions: { orderBy: { order: "asc" }, include: { question: { include: { options: { orderBy: { order: "asc" } }, topics: { include: { topic: true } } } } } },
      },
    })
  );
  if (!assessment) return null;
  await requireAssessmentReadAccess(assessment.courseId, actor);
  return assessment;
}

// --- AssessmentQuestion (bank link) --------------------------------------

async function nextQuestionOrder(assessmentId: string, actor: AuthzActor): Promise<number> {
  const max = await withRls(actorRlsCtx(actor), (tx) => tx.assessmentQuestion.aggregate({ where: { assessmentId }, _max: { order: true } }));
  return (max._max.order ?? -1) + 1;
}

export async function addQuestionToAssessment(
  assessmentId: string,
  questionId: string,
  input: { points?: number },
  actor: AuthzActor
) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const question = await withRls(actorRlsCtx(actor), (tx) => tx.question.findUnique({ where: { id: questionId }, select: { courseId: true } }));
  if (!question || question.courseId !== assessment.courseId) throw new Error("Question does not belong to this course");

  const order = await nextQuestionOrder(assessmentId, actor);
  await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentQuestion.upsert({
      where: { assessmentId_questionId: { assessmentId, questionId } },
      create: { assessmentId, questionId, order, points: input.points ?? 1 },
      update: { points: input.points ?? 1 },
    })
  );
}

export async function removeQuestionFromAssessment(assessmentId: string, questionId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) => tx.assessmentQuestion.deleteMany({ where: { assessmentId, questionId } }));
}

export async function reorderAssessmentQuestions(assessmentId: string, orderedQuestionIds: string[], actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), async (tx) => {
    for (let i = 0; i < orderedQuestionIds.length; i++) {
      await tx.assessmentQuestion.update({
        where: { assessmentId_questionId: { assessmentId, questionId: orderedQuestionIds[i] } },
        data: { order: i },
      });
    }
  });
}

// --- Publish / versioning -------------------------------------------------

/** The shape frozen into AssessmentVersion.questions at publish time. Carries the full answer key — see the migration's design note on redaction being an application-layer concern. */
export interface SnapshotQuestion {
  questionId: string;
  order: number;
  points: number;
  type: "single_choice" | "multiple_choice" | "short_answer";
  prompt: string;
  explanation: string;
  difficulty: string;
  learningObjective: string;
  options: { id: string; text: string; isCorrect: boolean; order: number }[];
  acceptableAnswers: string[] | null;
}

/**
 * Publishes (or re-publishes) an assessment: snapshots the current title/
 * instructions/question tree into a new immutable AssessmentVersion,
 * bumps Assessment.version, sets status=published. Requires at least one
 * question. This is the content-versioning foundation the session brief
 * requires — see the module docstring.
 */
export async function publishAssessment(assessmentId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: { orderBy: { order: "asc" }, include: { question: { include: { options: { orderBy: { order: "asc" } } } } } } },
    })
  );
  if (!assessment) throw new Error("Assessment not found");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  if (assessment.questions.length === 0) throw new Error("Cannot publish an assessment with no questions");

  const snapshot: SnapshotQuestion[] = assessment.questions.map((aq) => ({
    questionId: aq.questionId,
    order: aq.order,
    points: aq.points,
    type: aq.question.type,
    prompt: aq.question.prompt,
    explanation: aq.question.explanation,
    difficulty: aq.question.difficulty,
    learningObjective: aq.question.learningObjective,
    options: aq.question.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, order: o.order })),
    acceptableAnswers: (aq.question.acceptableAnswers as string[] | null) ?? null,
  }));

  const nextVersion = assessment.version + 1;

  await withRls(actorRlsCtx(actor), async (tx) => {
    await tx.assessmentVersion.create({
      data: {
        assessmentId,
        version: nextVersion,
        title: assessment.title,
        instructions: assessment.instructions,
        questions: snapshot as object,
        publishedBy: actor.id,
      },
    });
    await tx.assessment.update({
      where: { id: assessmentId },
      data: { status: "published", version: nextVersion, publishedAt: new Date() },
    });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "assessment.published",
    entityType: "Assessment",
    entityId: assessmentId,
    metadata: { version: nextVersion, questionCount: snapshot.length },
  });
}

/** The latest published AssessmentVersion, or null if never published. */
export async function getCurrentPublishedVersion(assessmentId: string, actor: AuthzActor) {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentVersion.findFirst({ where: { assessmentId }, orderBy: { version: "desc" } })
  );
}

/** Fetches one specific immutable snapshot by its own id — proves a past version was never mutated by a later republish. */
export async function getAssessmentVersionById(assessmentVersionId: string, actor: AuthzActor) {
  const version = await withRls(actorRlsCtx(actor), (tx) => tx.assessmentVersion.findUnique({ where: { id: assessmentVersionId } }));
  if (!version) return null;
  await requireAssessmentReadAccess((await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUniqueOrThrow({ where: { id: version.assessmentId }, select: { courseId: true } }))).courseId, actor);
  return version;
}

// --- Assignment (to cohort or student) -------------------------------------

/**
 * Target-existence checks below use the raw `prisma` singleton (bypasses
 * RLS), the same precedent src/lib/courses.ts's assignTeacherToCohort()/
 * enrollStudent() already establish for role/membership fact-checks — the
 * calling actor's authority over the *action* is already proven by
 * requireCourseContentAccess() (course-scoped) above each call; these are
 * pure existence checks, not data returned to the caller. This avoids
 * inheriting the cohort_teachers RLS policies' per-cohort granularity
 * (course-scoped ownership vs. cohort-scoped RLS — a pre-existing,
 * documented gap, see docs/TEACHER.md's "cohort visibility" note) into a
 * new authorization decision.
 */
async function assertCohortBelongsToCourse(cohortId: string, courseId: string): Promise<void> {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { courseId: true } });
  if (!cohort || cohort.courseId !== courseId) throw new Error("Cohort does not belong to this course");
}

async function assertStudentEnrolledInCourse(studentUserId: string, courseId: string): Promise<void> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentUserId, status: { in: ["active", "completed"] }, cohort: { courseId } },
  });
  if (!enrollment) throw new Error("Student is not enrolled in this course");
}

export async function assignAssessmentToCohort(assessmentId: string, cohortId: string, opts: { dueAt?: Date }, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true, status: true } }));
  if (!assessment) throw new Error("Assessment not found");
  if (assessment.status !== "published") throw new Error("Cannot assign a draft assessment");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);
  await assertCohortBelongsToCourse(cohortId, assessment.courseId);

  const assignment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentAssignment.create({
      data: { assessmentId, courseId: assessment.courseId, scope: "cohort", cohortId, dueAt: opts.dueAt, createdBy: actor.id },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "assessment.assigned_cohort", entityType: "Assessment", entityId: assessmentId, metadata: { cohortId } });
  return assignment;
}

export async function assignAssessmentToStudent(assessmentId: string, studentUserId: string, opts: { dueAt?: Date }, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true, status: true } }));
  if (!assessment) throw new Error("Assessment not found");
  if (assessment.status !== "published") throw new Error("Cannot assign a draft assessment");
  await requireCourseContentAccess(assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);
  await assertStudentEnrolledInCourse(studentUserId, assessment.courseId);

  const assignment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentAssignment.create({
      data: { assessmentId, courseId: assessment.courseId, scope: "student", studentUserId, dueAt: opts.dueAt, createdBy: actor.id },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "assessment.assigned_student", entityType: "Assessment", entityId: assessmentId, metadata: { studentUserId } });
  return assignment;
}

export async function unassignAssessment(assignmentId: string, actor: AuthzActor) {
  const assignment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentAssignment.findUnique({ where: { id: assignmentId }, include: { assessment: { select: { courseId: true } } } })
  );
  if (!assignment) throw new Error("Assignment not found");
  await requireCourseContentAccess(assignment.assessment.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) => tx.assessmentAssignment.delete({ where: { id: assignmentId } }));

  // Session 33 (Data Integrity Investigation), landed by Session 45: this
  // is the only deletion path anywhere in the codebase for
  // assessment_assignments rows and had no audit trail at all — found
  // while investigating why that table (and attempts, which can only ever
  // be created against an existing assignment — see startAttempt()) turned
  // up completely empty in production with no evidence either way in
  // audit_events. Session 45 went on to prove nothing was ever deleted
  // (the rows were never created — see that session's handoff), but the
  // gap this found is real on its own terms and is fixed here as targeted
  // hardening of an under-audited cleanup path, per CLAUDE_BUILD_RULES.md
  // §6's "audit ... sensitive operations."
  await recordAuditEvent({
    actorId: actor.id,
    action: "assessment.unassigned",
    entityType: "AssessmentAssignment",
    entityId: assignmentId,
    metadata: { assessmentId: assignment.assessmentId, cohortId: assignment.cohortId, studentUserId: assignment.studentUserId },
  });
}

/** Requires courses.manage, super_admin, or being a teacher on the course. */
export async function listAssignmentsForAssessment(assessmentId: string, actor: AuthzActor) {
  const assessment = await withRls(actorRlsCtx(actor), (tx) => tx.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } }));
  if (!assessment) throw new Error("Assessment not found");
  await requireAssessmentReadAccess(assessment.courseId, actor);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentAssignment.findMany({
      where: { assessmentId },
      orderBy: { createdAt: "desc" },
      include: { cohort: { select: { id: true, name: true } }, student: { select: { id: true, name: true, email: true } } },
    })
  );
}

/**
 * Self-scoped: a student's own assigned, published assessments across every
 * course they're enrolled in — no permission required beyond self-scoping
 * (mirrors listMyEnrollments()). This is the contract Session 06's
 * "/student/assessments" BlockedFeature stub anticipated.
 */
export async function listMyAssignedAssessments(actor: AuthzActor) {
  const assignments = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assessmentAssignment.findMany({
      where: {
        OR: [
          { studentUserId: actor.id },
          { cohort: { enrollments: { some: { studentUserId: actor.id, status: { in: ["active", "completed"] } } } } },
        ],
        assessment: { status: "published" },
      },
      include: { assessment: { include: { course: { select: { id: true, title: true } } } } },
      orderBy: { createdAt: "desc" },
    })
  );

  // De-duplicate (a student can theoretically be reachable by more than one
  // assignment row for the same assessment — e.g. both a cohort assignment
  // and a later direct one) and attach this student's own attempt history.
  const byAssessment = new Map<string, (typeof assignments)[number]>();
  for (const a of assignments) if (!byAssessment.has(a.assessmentId)) byAssessment.set(a.assessmentId, a);

  const attempts = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findMany({
      where: { studentUserId: actor.id, assessmentId: { in: [...byAssessment.keys()] } },
      orderBy: { attemptNumber: "desc" },
    })
  );
  const attemptsByAssessment = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = attemptsByAssessment.get(a.assessmentId) ?? [];
    list.push(a);
    attemptsByAssessment.set(a.assessmentId, list);
  }

  return [...byAssessment.values()].map((a) => ({
    assignment: a,
    assessment: a.assessment,
    attempts: attemptsByAssessment.get(a.assessmentId) ?? [],
  }));
}
