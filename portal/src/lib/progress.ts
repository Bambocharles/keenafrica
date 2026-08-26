import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent, onDomainEvent } from "@/lib/events";
import { actorRlsCtx, assertActiveEnrollment, assertCanManageOrTeachCourse } from "@/lib/courses";

/**
 * Progress & Adaptive Learning (Session 08).
 *
 * Core model: Student activity -> evidence -> progress/mastery -> views.
 * This module owns exactly one new evidence table (LessonProgress, see
 * schema.prisma) plus pure read-time calculation functions over it and over
 * Assessment's (Session 07) existing Attempt/Answer/QuestionTopic evidence.
 * There is no separate analytics database and no stored/cached mastery
 * snapshot — every mastery/weak-area read below is computed fresh from the
 * canonical Attempt/Answer/LessonProgress rows, so there is nothing to
 * invalidate or let drift out of sync with the underlying evidence, and
 * nothing here ever re-grades an answer or re-derives what "published"/
 * "enrolled" means — those stay Education Core's/Assessment's own logic,
 * only ever read, never reimplemented.
 *
 * Event-driven completion: markLessonComplete() emits LessonCompleted (the
 * event Session 01 pre-typed and Session 04 explicitly deferred to this
 * session — "Session 08 owns Enrollment.completedAt and LessonCompleted
 * emission") and then AWAITS recalculateCourseProgress() directly, so a
 * caller sees fully consistent Enrollment state the moment the function
 * returns (no fire-and-forget race). recalculateCourseProgress() is ALSO
 * registered below as this module's own onDomainEvent("LessonCompleted", ...)
 * listener, satisfying PLATFORM_ARCHITECTURE.md §9's "subscribe to events"
 * convention for any future path that might record a lesson completion
 * without going through markLessonComplete() directly. Since recalculation
 * is a pure, idempotent function of current DB state, the listener's
 * redundant re-run on the exact same call is harmless (recomputes the same
 * already-correct answer). AssessmentGraded (Session 07) is deliberately
 * NOT subscribed to: topic mastery is computed live from Attempt/Answer on
 * every read (see getTopicMasteryForStudent), so there is no cached state
 * for that event to invalidate — subscribing to it here would be a listener
 * with nothing to do.
 *
 * Enrollment.completedAt/status is Education Core's (Session 04) table, but
 * that field was explicitly reserved for this session to fill in (see the
 * Session 04 handoff). Writing it requires `courses.manage` under
 * enrollments_update's RLS policy (education_core migration) — a STUDENT
 * actor cannot update their own enrollment row directly, by design. Rather
 * than a blanket super_admin bypass, recalculateCourseProgress() runs under
 * a synthesized RLS context holding ONLY courses.manage — the same
 * least-privilege "system context" shape Session 02 established for
 * revokeAllUserSessionsAsSystem(). This is deliberately not exported for
 * general use: every caller must have already authorized touching this
 * specific (courseId, studentUserId) pair (markLessonComplete has, via
 * assertActiveEnrollment; the event listener trusts the emitter had).
 */

function systemProgressCtx() {
  return { isSuperAdmin: false, permissions: [PERMISSIONS.COURSES_MANAGE] };
}

// --- Lesson completion ------------------------------------------------

export interface LessonProgressRecord {
  id: string;
  studentUserId: string;
  lessonId: string;
  courseId: string;
  completedAt: Date;
}

/**
 * Records that the acting student completed a published lesson they're
 * actively (or already completed-) enrolled in. Idempotent — completing an
 * already-completed lesson is a no-op read, not a duplicate row or a
 * re-emitted event. Requires an explicit courseId from the caller (not
 * resolved internally) so assertActiveEnrollment can run BEFORE any lesson
 * lookup — same ordering/privacy reasoning as notes.ts's createNote(): an
 * actor with no enrollment in courseId never learns whether lessonId even
 * exists.
 */
export async function markLessonComplete(
  courseId: string,
  lessonId: string,
  actor: AuthzActor
): Promise<LessonProgressRecord> {
  await assertActiveEnrollment(courseId, actor);

  const lesson = await withRls(actorRlsCtx(actor), (tx) =>
    tx.lesson.findFirst({ where: { id: lessonId, courseId, status: "published" }, select: { id: true } })
  );
  if (!lesson) throw new AuthorizationError("Lesson not found or not published");

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.lessonProgress.findUnique({
      where: { studentUserId_lessonId: { studentUserId: actor.id, lessonId } },
    })
  );
  if (existing) return existing;

  const progress = await withRls(actorRlsCtx(actor), (tx) =>
    tx.lessonProgress.create({ data: { studentUserId: actor.id, lessonId, courseId } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "lesson.completed",
    entityType: "Lesson",
    entityId: lessonId,
    metadata: { courseId },
  });
  emitDomainEvent("LessonCompleted", { lessonId, studentId: actor.id, courseId });

  await recalculateCourseProgress(courseId, actor.id);

  return progress;
}

/**
 * Internal — see the module docstring's "Enrollment.completedAt/status"
 * section. Recomputes whether the student has completed every currently-
 * published lesson in courseId and writes the result to every active/
 * completed Enrollment they hold in that course. Fully reversible: if a
 * teacher publishes a new lesson after a student had completed everything,
 * the next recalculation correctly moves status back from 'completed' to
 * 'active' — this is what the recalculation/regression tests exercise.
 * Never touches a 'withdrawn' enrollment.
 */
export async function recalculateCourseProgress(courseId: string, studentUserId: string): Promise<void> {
  const ctx = systemProgressCtx();

  const [publishedLessons, completedLessons, enrollments] = await withRls(ctx, (tx) =>
    Promise.all([
      tx.lesson.count({ where: { courseId, status: "published" } }),
      tx.lessonProgress.count({ where: { courseId, studentUserId } }),
      tx.enrollment.findMany({
        where: { studentUserId, status: { in: ["active", "completed"] }, cohort: { courseId } },
      }),
    ])
  );

  const isComplete = publishedLessons > 0 && completedLessons >= publishedLessons;

  for (const enrollment of enrollments) {
    const alreadyMarked = enrollment.status === "completed";
    if (isComplete && !alreadyMarked) {
      await withRls(ctx, (tx) =>
        tx.enrollment.update({ where: { id: enrollment.id }, data: { status: "completed", completedAt: new Date() } })
      );
    } else if (!isComplete && alreadyMarked) {
      await withRls(ctx, (tx) =>
        tx.enrollment.update({ where: { id: enrollment.id }, data: { status: "active", completedAt: null } })
      );
    }
  }
}

onDomainEvent("LessonCompleted", async ({ courseId, studentId }) => {
  await recalculateCourseProgress(courseId, studentId);
});

// --- Course/module/lesson progress reads --------------------------------

export interface StudentCourseProgress {
  courseId: string;
  title: string;
  totalLessons: number;
  completedLessons: number;
  percentComplete: number;
  modules: {
    moduleId: string;
    title: string;
    totalLessons: number;
    completedLessons: number;
    lessons: { lessonId: string; title: string; completed: boolean; completedAt: Date | null }[];
  }[];
}

/** Self-scoped: requires an active/completed enrollment in courseId. */
export async function getCourseProgressForStudent(courseId: string, actor: AuthzActor): Promise<StudentCourseProgress> {
  await assertActiveEnrollment(courseId, actor);

  const [course, myProgress] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.course.findUnique({
        where: { id: courseId },
        include: {
          modules: {
            where: { status: "published" },
            orderBy: { order: "asc" },
            include: { lessons: { where: { status: "published" }, orderBy: { order: "asc" } } },
          },
        },
      }),
      tx.lessonProgress.findMany({ where: { courseId, studentUserId: actor.id } }),
    ])
  );
  if (!course) throw new Error("Course not found");

  const progressByLesson = new Map(myProgress.map((p) => [p.lessonId, p.completedAt]));

  const modules = course.modules.map((m) => {
    const lessons = m.lessons.map((l) => ({
      lessonId: l.id,
      title: l.title,
      completed: progressByLesson.has(l.id),
      completedAt: progressByLesson.get(l.id) ?? null,
    }));
    return {
      moduleId: m.id,
      title: m.title,
      totalLessons: lessons.length,
      completedLessons: lessons.filter((l) => l.completed).length,
      lessons,
    };
  });

  const totalLessons = modules.reduce((sum, m) => sum + m.totalLessons, 0);
  const completedLessons = modules.reduce((sum, m) => sum + m.completedLessons, 0);

  return {
    courseId,
    title: course.title,
    totalLessons,
    completedLessons,
    percentComplete: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
    modules,
  };
}

export interface CohortStudentProgress {
  studentId: string;
  name: string;
  email: string;
  enrollmentStatus: string;
  totalLessons: number;
  completedLessons: number;
  percentComplete: number;
}

export interface CohortProgressReport {
  cohortId: string;
  courseId: string;
  cohortName: string;
  totalLessons: number;
  students: CohortStudentProgress[];
}

/** Teacher-facing: requires courses.manage, super_admin, or being a teacher on the cohort's course. */
export async function getCourseProgressForCohort(cohortId: string, actor: AuthzActor): Promise<CohortProgressReport> {
  const cohort = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohort.findUnique({ where: { id: cohortId }, select: { courseId: true, name: true } })
  );
  if (!cohort) throw new Error("Cohort not found");
  await assertCanManageOrTeachCourse(cohort.courseId, actor);

  const [publishedLessons, enrollments] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.lesson.count({ where: { courseId: cohort.courseId, status: "published" } }),
      tx.enrollment.findMany({
        where: { cohortId },
        orderBy: { enrolledAt: "desc" },
        include: { student: { select: { id: true, name: true, email: true } } },
      }),
    ])
  );

  const studentIds = enrollments.map((e) => e.studentUserId);
  const progressRows = studentIds.length
    ? await withRls(actorRlsCtx(actor), (tx) =>
        tx.lessonProgress.findMany({ where: { courseId: cohort.courseId, studentUserId: { in: studentIds } } })
      )
    : [];

  const completedByStudent = new Map<string, number>();
  for (const row of progressRows) {
    completedByStudent.set(row.studentUserId, (completedByStudent.get(row.studentUserId) ?? 0) + 1);
  }

  const students: CohortStudentProgress[] = enrollments.map((e) => {
    const completedLessons = completedByStudent.get(e.studentUserId) ?? 0;
    return {
      studentId: e.studentUserId,
      name: e.student.name,
      email: e.student.email,
      enrollmentStatus: e.status,
      totalLessons: publishedLessons,
      completedLessons,
      percentComplete: publishedLessons > 0 ? Math.round((completedLessons / publishedLessons) * 100) : 0,
    };
  });

  return { cohortId, courseId: cohort.courseId, cohortName: cohort.name, totalLessons: publishedLessons, students };
}

// --- Topic mastery ---------------------------------------------------
//
// The calculation algorithm is deliberately simple and deterministic for
// this foundation, per the session brief ("do not start with a giant AI
// system — first establish reliable structured educational data. The
// calculation algorithm can evolve."). Evidence sources, in priority order:
//   1. Graded assessment answers (Attempt.status='graded', via
//      Question -> QuestionTopic -> Topic) — the strongest signal, a real
//      correct/incorrect verdict Session 07 already computed. Mastery here
//      is never re-graded, only read.
//   2. Completed-lesson exposure (LessonProgress -> Lesson -> LessonTopic)
//      — a weaker, un-scored "the student engaged with this topic's
//      content" signal, used only when NO assessment evidence exists yet
//      for that topic (basedOn: "lesson_activity", masteryLevel:
//      "exposure_only" — deliberately never classified weak/strong, since
//      there is no correctness signal to base that on).

const WEAK_THRESHOLD_PERCENT = 50;
const STRONG_THRESHOLD_PERCENT = 75;

export type MasteryLevel = "weak" | "developing" | "strong" | "exposure_only";

export interface TopicMasteryEntry {
  topicId: string;
  topicName: string;
  basedOn: "assessment" | "lesson_activity";
  correctCount: number;
  totalGraded: number;
  accuracyPercent: number | null;
  lessonsCompleted: number;
  masteryLevel: MasteryLevel;
}

interface AnswerForMastery {
  isCorrect: boolean | null;
  question: { topics: { topic: { id: string; name: string } }[] };
}
interface LessonProgressForMastery {
  lesson: { topics: { topic: { id: string; name: string } }[] };
}

/** Pure, exported for unit testing independent of the DB. */
export function aggregateTopicMastery(
  answers: AnswerForMastery[],
  lessonProgress: LessonProgressForMastery[]
): TopicMasteryEntry[] {
  const byTopic = new Map<string, { name: string; correct: number; total: number; lessons: number }>();
  const ensure = (id: string, name: string) => {
    let entry = byTopic.get(id);
    if (!entry) {
      entry = { name, correct: 0, total: 0, lessons: 0 };
      byTopic.set(id, entry);
    }
    return entry;
  };

  for (const a of answers) {
    for (const qt of a.question.topics) {
      const entry = ensure(qt.topic.id, qt.topic.name);
      entry.total += 1;
      if (a.isCorrect) entry.correct += 1;
    }
  }
  for (const lp of lessonProgress) {
    for (const lt of lp.lesson.topics) {
      const entry = ensure(lt.topic.id, lt.topic.name);
      entry.lessons += 1;
    }
  }

  return Array.from(byTopic.entries())
    .map(([topicId, v]): TopicMasteryEntry => {
      if (v.total > 0) {
        const accuracyPercent = Math.round((v.correct / v.total) * 100);
        const masteryLevel: MasteryLevel =
          accuracyPercent < WEAK_THRESHOLD_PERCENT ? "weak" : accuracyPercent < STRONG_THRESHOLD_PERCENT ? "developing" : "strong";
        return {
          topicId,
          topicName: v.name,
          basedOn: "assessment",
          correctCount: v.correct,
          totalGraded: v.total,
          accuracyPercent,
          lessonsCompleted: v.lessons,
          masteryLevel,
        };
      }
      return {
        topicId,
        topicName: v.name,
        basedOn: "lesson_activity",
        correctCount: 0,
        totalGraded: 0,
        accuracyPercent: null,
        lessonsCompleted: v.lessons,
        masteryLevel: "exposure_only",
      };
    })
    .sort((a, b) => (a.accuracyPercent ?? -1) - (b.accuracyPercent ?? -1));
}

/** Self-scoped — no permission required beyond self-scoping (mirrors listMyResults()). Optionally scoped to one course. */
export async function getTopicMasteryForStudent(
  actor: AuthzActor,
  filter: { courseId?: string } = {}
): Promise<TopicMasteryEntry[]> {
  const [answers, lessonProgress] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.answer.findMany({
        where: {
          isCorrect: { not: null },
          attempt: {
            studentUserId: actor.id,
            status: "graded",
            ...(filter.courseId ? { assessment: { courseId: filter.courseId } } : {}),
          },
        },
        select: {
          isCorrect: true,
          question: { select: { topics: { select: { topic: { select: { id: true, name: true } } } } } },
        },
      }),
      tx.lessonProgress.findMany({
        where: { studentUserId: actor.id, ...(filter.courseId ? { courseId: filter.courseId } : {}) },
        select: { lesson: { select: { topics: { select: { topic: { select: { id: true, name: true } } } } } } },
      }),
    ])
  );

  return aggregateTopicMastery(answers, lessonProgress);
}

export interface WeakStrongTopics {
  weak: TopicMasteryEntry[];
  strong: TopicMasteryEntry[];
}

export async function getWeakStrongTopicsForStudent(
  actor: AuthzActor,
  filter: { courseId?: string } = {}
): Promise<WeakStrongTopics> {
  const mastery = await getTopicMasteryForStudent(actor, filter);
  return {
    weak: mastery.filter((m) => m.masteryLevel === "weak"),
    strong: mastery.filter((m) => m.masteryLevel === "strong"),
  };
}

export interface CohortTopicMasteryEntry {
  topicId: string;
  topicName: string;
  totalGradedAnswers: number;
  correctAnswers: number;
  cohortAccuracyPercent: number | null;
  studentsWithEvidence: number;
  studentsWeak: number;
  studentsStrong: number;
}

/** Teacher-facing cohort-level topic performance. Requires courses.manage, super_admin, or being a teacher on the cohort's course. */
export async function getTopicMasteryForCohort(cohortId: string, actor: AuthzActor): Promise<CohortTopicMasteryEntry[]> {
  const cohort = await withRls(actorRlsCtx(actor), (tx) => tx.cohort.findUnique({ where: { id: cohortId }, select: { courseId: true } }));
  if (!cohort) throw new Error("Cohort not found");
  await assertCanManageOrTeachCourse(cohort.courseId, actor);

  const enrollments = await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findMany({ where: { cohortId }, select: { studentUserId: true } })
  );
  const studentIds = enrollments.map((e) => e.studentUserId);
  if (studentIds.length === 0) return [];

  const answers = await withRls(actorRlsCtx(actor), (tx) =>
    tx.answer.findMany({
      where: {
        isCorrect: { not: null },
        attempt: { studentUserId: { in: studentIds }, status: "graded", assessment: { courseId: cohort.courseId } },
      },
      select: {
        isCorrect: true,
        attempt: { select: { studentUserId: true } },
        question: { select: { topics: { select: { topic: { select: { id: true, name: true } } } } } },
      },
    })
  );

  const byTopic = new Map<
    string,
    { name: string; correct: number; total: number; perStudent: Map<string, { correct: number; total: number }> }
  >();
  for (const a of answers) {
    for (const qt of a.question.topics) {
      const t = qt.topic;
      let acc = byTopic.get(t.id);
      if (!acc) {
        acc = { name: t.name, correct: 0, total: 0, perStudent: new Map() };
        byTopic.set(t.id, acc);
      }
      acc.total += 1;
      if (a.isCorrect) acc.correct += 1;

      const sid = a.attempt.studentUserId;
      let s = acc.perStudent.get(sid);
      if (!s) {
        s = { correct: 0, total: 0 };
        acc.perStudent.set(sid, s);
      }
      s.total += 1;
      if (a.isCorrect) s.correct += 1;
    }
  }

  return Array.from(byTopic.entries())
    .map(([topicId, acc]): CohortTopicMasteryEntry => {
      let studentsWeak = 0;
      let studentsStrong = 0;
      for (const s of acc.perStudent.values()) {
        const pct = (s.correct / s.total) * 100;
        if (pct < WEAK_THRESHOLD_PERCENT) studentsWeak += 1;
        else if (pct >= STRONG_THRESHOLD_PERCENT) studentsStrong += 1;
      }
      return {
        topicId,
        topicName: acc.name,
        totalGradedAnswers: acc.total,
        correctAnswers: acc.correct,
        cohortAccuracyPercent: acc.total > 0 ? Math.round((acc.correct / acc.total) * 100) : null,
        studentsWithEvidence: acc.perStudent.size,
        studentsWeak,
        studentsStrong,
      };
    })
    .sort((a, b) => (a.cohortAccuracyPercent ?? 0) - (b.cohortAccuracyPercent ?? 0));
}

// --- Recommendations contract (future-ready seam) ------------------------

export interface FocusAreaRecommendation {
  topicId: string;
  topicName: string;
  reason: "weak_assessment_performance";
  accuracyPercent: number | null;
}

/**
 * The seam PLATFORM_ARCHITECTURE.md §12 anticipates for personalized study
 * plans / adaptive practice / AI tutoring / the future UTME prep engine.
 * Deliberately rule-based, not AI — per this session's "Must NOT let AI
 * become the source of truth for raw educational evidence," any future
 * adaptive/AI system should sit ON TOP of this function's real, structured
 * evidence (or call it directly), never replace it. Returns the student's
 * weakest-evidenced topics (by assessment accuracy), worst first, capped at
 * `limit`.
 */
export async function getRecommendedFocusAreas(
  actor: AuthzActor,
  opts: { courseId?: string; limit?: number } = {}
): Promise<FocusAreaRecommendation[]> {
  const mastery = await getTopicMasteryForStudent(actor, { courseId: opts.courseId });
  const limit = opts.limit ?? 5;
  return mastery
    .filter((m) => m.masteryLevel === "weak")
    .slice(0, limit)
    .map((m) => ({
      topicId: m.topicId,
      topicName: m.topicName,
      reason: "weak_assessment_performance" as const,
      accuracyPercent: m.accuracyPercent,
    }));
}
