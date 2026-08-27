import { withRls } from "@/lib/rls";
import { PERMISSIONS, requirePermission, type AuthzActor } from "@/lib/authz";
import { actorRlsCtx, assertCanManageOrTeachCourse } from "@/lib/courses";
import {
  requireProjectSponsorAccess,
  listMilestonesForProject,
  listProjectMetrics,
  getProjectImpactSummary,
  type ImpactSummaryEntry,
} from "@/lib/sponsor";

/**
 * Reporting & Impact (Session 12).
 *
 * Turns existing platform activity into operational and sponsor-impact
 * reports. This module owns ZERO new tables and ZERO new permission keys —
 * every function below is a pure, read-time aggregation over the canonical
 * Education Core (Session 04: Course/Cohort/Enrollment), Assessment
 * (Session 07: Attempt/Answer), Progress (Session 08: LessonProgress), and
 * Sponsor Core (Session 11: Milestone/ProjectMetric/ProjectMembership)
 * tables — the exact same "no separate analytics database, nothing to
 * invalidate" discipline Session 08's progress.ts established for topic
 * mastery. See docs/REPORTING.md for the full metric-definition contract
 * (source entities/events, exact formulas, filter semantics).
 *
 * Authorization reuses existing gates, unchanged, per CLAUDE_BUILD_RULES.md
 * §3 ("do not create parallel systems"):
 *   - Admin operational reports: courses.manage (or super_admin) — the same
 *     "full, non-ownership-scoped visibility" gate courses.ts's
 *     listCourses()/admin-stats.ts's getSystemStatus() already use.
 *   - Teacher cohort reports: assertCanManageOrTeachCourse() (courses.ts) —
 *     the exact same ownership check progress.ts's
 *     getCourseProgressForCohort()/getTopicMasteryForCohort() already use.
 *   - Sponsor project reports: requireProjectSponsorAccess() (sponsor.ts) —
 *     the exact same ownership check every other sponsor-portal read uses.
 *
 * Privacy ("Must NOT expose raw private student notes/messages in sponsor
 * reports"): this module never reads student_notes, bookmarks,
 * conversations, or messages at all — no report here touches those tables.
 * getBeneficiaryEngagementSummary() is the one sponsor-facing function that
 * reads Education Core data keyed by student identity, and it returns
 * PLATFORM-WIDE AGGREGATE COUNTS ONLY (never a per-student row, name, score,
 * or any raw text) — see that function's own docstring for the RLS-bypass
 * reasoning, which mirrors sponsor.ts's listProjectBeneficiaries() exactly.
 */

export interface DateRangeFilter {
  from?: Date;
  to?: Date;
}

function dateRangeWhere(filter: DateRangeFilter): { gte?: Date; lte?: Date } | undefined {
  if (!filter.from && !filter.to) return undefined;
  return { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
}

function requireAdminReporting(actor: AuthzActor): void {
  if (actor.isSuperAdmin) return;
  requirePermission(actor, PERMISSIONS.COURSES_MANAGE);
}

// --- Admin: Completion report ----------------------------------------------
//
// Metric definition (see docs/REPORTING.md): one row per Enrollment whose
// enrolledAt falls in [from, to] (default: all time), grouped by course.
// completionRatePercent = completed / enrollments for that course, rounded.
// "completed" is Enrollment.status === 'completed' — Session 08's real,
// evidence-driven, reversible completion flag (never re-derived here).

export interface CourseCompletionRow {
  courseId: string;
  courseTitle: string;
  enrollments: number;
  completed: number;
  active: number;
  withdrawn: number;
  completionRatePercent: number;
}

export interface AdminCompletionReport {
  generatedAt: Date;
  filter: { courseId?: string; from?: Date; to?: Date };
  totals: { enrollments: number; completed: number; completionRatePercent: number };
  courses: CourseCompletionRow[];
}

export async function getAdminCompletionReport(
  actor: AuthzActor,
  filter: { courseId?: string } & DateRangeFilter = {}
): Promise<AdminCompletionReport> {
  requireAdminReporting(actor);

  const enrolledAt = dateRangeWhere(filter);
  const enrollments = await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findMany({
      where: {
        ...(filter.courseId ? { cohort: { courseId: filter.courseId } } : {}),
        ...(enrolledAt ? { enrolledAt } : {}),
      },
      select: { status: true, cohort: { select: { courseId: true, course: { select: { title: true } } } } },
    })
  );

  const byCourse = new Map<
    string,
    { title: string; enrollments: number; completed: number; active: number; withdrawn: number }
  >();
  for (const e of enrollments) {
    const cid = e.cohort.courseId;
    let entry = byCourse.get(cid);
    if (!entry) {
      entry = { title: e.cohort.course.title, enrollments: 0, completed: 0, active: 0, withdrawn: 0 };
      byCourse.set(cid, entry);
    }
    entry.enrollments += 1;
    if (e.status === "completed") entry.completed += 1;
    else if (e.status === "active") entry.active += 1;
    else entry.withdrawn += 1;
  }

  const courses: CourseCompletionRow[] = Array.from(byCourse.entries())
    .map(([courseId, v]) => ({
      courseId,
      courseTitle: v.title,
      enrollments: v.enrollments,
      completed: v.completed,
      active: v.active,
      withdrawn: v.withdrawn,
      completionRatePercent: v.enrollments > 0 ? Math.round((v.completed / v.enrollments) * 100) : 0,
    }))
    .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle));

  const totalEnrollments = enrollments.length;
  const totalCompleted = enrollments.filter((e) => e.status === "completed").length;

  return {
    generatedAt: new Date(),
    filter: { courseId: filter.courseId, from: filter.from, to: filter.to },
    totals: {
      enrollments: totalEnrollments,
      completed: totalCompleted,
      completionRatePercent: totalEnrollments > 0 ? Math.round((totalCompleted / totalEnrollments) * 100) : 0,
    },
    courses,
  };
}

// --- Admin: Assessment outcomes report --------------------------------
//
// Metric definition: one row per Assessment with at least one Attempt whose
// submittedAt falls in [from, to] (status submitted OR graded — a pending-
// manual-grade attempt still counts as an attempt). avgScorePercent/
// passRatePercent are computed only over GRADED attempts (scorePercent/
// passed are null until grading finishes) — never re-graded here, only
// read from attempts.ts's existing scoring.

export interface AssessmentOutcomeRow {
  assessmentId: string;
  assessmentTitle: string;
  courseId: string;
  courseTitle: string;
  attempts: number;
  gradedAttempts: number;
  avgScorePercent: number | null;
  passRatePercent: number | null;
}

export interface AdminAssessmentOutcomesReport {
  generatedAt: Date;
  filter: { courseId?: string; assessmentId?: string; from?: Date; to?: Date };
  totals: { attempts: number; gradedAttempts: number; avgScorePercent: number | null; passRatePercent: number | null };
  assessments: AssessmentOutcomeRow[];
}

interface OutcomeAccumulator {
  title: string;
  courseId: string;
  courseTitle: string;
  attempts: number;
  graded: number;
  scoreSum: number;
  passedCount: number;
  passEligible: number;
}

export async function getAdminAssessmentOutcomesReport(
  actor: AuthzActor,
  filter: { courseId?: string; assessmentId?: string } & DateRangeFilter = {}
): Promise<AdminAssessmentOutcomesReport> {
  requireAdminReporting(actor);

  const submittedAt = dateRangeWhere(filter);
  const attempts = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findMany({
      where: {
        status: { in: ["submitted", "graded"] },
        ...(filter.courseId ? { assessment: { courseId: filter.courseId } } : {}),
        ...(filter.assessmentId ? { assessmentId: filter.assessmentId } : {}),
        ...(submittedAt ? { submittedAt } : {}),
      },
      select: {
        status: true,
        scorePercent: true,
        passed: true,
        assessment: { select: { id: true, title: true, courseId: true, course: { select: { title: true } } } },
      },
    })
  );

  const byAssessment = new Map<string, OutcomeAccumulator>();
  for (const a of attempts) {
    const id = a.assessment.id;
    let e = byAssessment.get(id);
    if (!e) {
      e = {
        title: a.assessment.title,
        courseId: a.assessment.courseId,
        courseTitle: a.assessment.course.title,
        attempts: 0,
        graded: 0,
        scoreSum: 0,
        passedCount: 0,
        passEligible: 0,
      };
      byAssessment.set(id, e);
    }
    e.attempts += 1;
    if (a.status === "graded") {
      e.graded += 1;
      e.scoreSum += a.scorePercent ?? 0;
      if (a.passed !== null) {
        e.passEligible += 1;
        if (a.passed) e.passedCount += 1;
      }
    }
  }

  const assessments: AssessmentOutcomeRow[] = Array.from(byAssessment.entries())
    .map(([assessmentId, v]) => ({
      assessmentId,
      assessmentTitle: v.title,
      courseId: v.courseId,
      courseTitle: v.courseTitle,
      attempts: v.attempts,
      gradedAttempts: v.graded,
      avgScorePercent: v.graded > 0 ? Math.round(v.scoreSum / v.graded) : null,
      passRatePercent: v.passEligible > 0 ? Math.round((v.passedCount / v.passEligible) * 100) : null,
    }))
    .sort((a, b) => a.assessmentTitle.localeCompare(b.assessmentTitle));

  const totalAttempts = attempts.length;
  const gradedAttempts = attempts.filter((a) => a.status === "graded");
  const totalScoreSum = gradedAttempts.reduce((s, a) => s + (a.scorePercent ?? 0), 0);
  const passEligible = gradedAttempts.filter((a) => a.passed !== null);
  const totalPassed = passEligible.filter((a) => a.passed).length;

  return {
    generatedAt: new Date(),
    filter: { courseId: filter.courseId, assessmentId: filter.assessmentId, from: filter.from, to: filter.to },
    totals: {
      attempts: totalAttempts,
      gradedAttempts: gradedAttempts.length,
      avgScorePercent: gradedAttempts.length > 0 ? Math.round(totalScoreSum / gradedAttempts.length) : null,
      passRatePercent: passEligible.length > 0 ? Math.round((totalPassed / passEligible.length) * 100) : null,
    },
    assessments,
  };
}

// --- Admin: Participation report ----------------------------------------
//
// Metric definition: "participation" = a student took a real, recorded
// learning action in the window — a lesson marked complete
// (LessonProgress.completedAt) or an assessment attempt submitted
// (Attempt.submittedAt), OR'd together per student. activeStudents is the
// COUNT OF DISTINCT students with at least one such action, never a raw
// list — this report is a count-only operational view, not a roster.

export interface CourseParticipationRow {
  courseId: string;
  courseTitle: string;
  lessonsCompleted: number;
  attemptsSubmitted: number;
  activeStudents: number;
}

export interface AdminParticipationReport {
  generatedAt: Date;
  filter: { from?: Date; to?: Date };
  totals: { lessonsCompleted: number; attemptsSubmitted: number; activeStudents: number };
  courses: CourseParticipationRow[];
}

export async function getAdminParticipationReport(
  actor: AuthzActor,
  filter: DateRangeFilter = {}
): Promise<AdminParticipationReport> {
  requireAdminReporting(actor);

  const windowWhere = dateRangeWhere(filter);
  const [progress, attempts] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.lessonProgress.findMany({
        where: windowWhere ? { completedAt: windowWhere } : {},
        select: { studentUserId: true, courseId: true, course: { select: { title: true } } },
      }),
      tx.attempt.findMany({
        where: { status: { in: ["submitted", "graded"] }, ...(windowWhere ? { submittedAt: windowWhere } : {}) },
        select: { studentUserId: true, assessment: { select: { courseId: true, course: { select: { title: true } } } } },
      }),
    ])
  );

  const byCourse = new Map<
    string,
    { title: string; lessonsCompleted: number; attemptsSubmitted: number; students: Set<string> }
  >();
  const ensure = (id: string, title: string) => {
    let e = byCourse.get(id);
    if (!e) {
      e = { title, lessonsCompleted: 0, attemptsSubmitted: 0, students: new Set() };
      byCourse.set(id, e);
    }
    return e;
  };
  for (const p of progress) {
    const e = ensure(p.courseId, p.course.title);
    e.lessonsCompleted += 1;
    e.students.add(p.studentUserId);
  }
  for (const a of attempts) {
    const e = ensure(a.assessment.courseId, a.assessment.course.title);
    e.attemptsSubmitted += 1;
    e.students.add(a.studentUserId);
  }

  const courses: CourseParticipationRow[] = Array.from(byCourse.entries())
    .map(([courseId, v]) => ({
      courseId,
      courseTitle: v.title,
      lessonsCompleted: v.lessonsCompleted,
      attemptsSubmitted: v.attemptsSubmitted,
      activeStudents: v.students.size,
    }))
    .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle));

  const allActiveStudents = new Set<string>();
  for (const p of progress) allActiveStudents.add(p.studentUserId);
  for (const a of attempts) allActiveStudents.add(a.studentUserId);

  return {
    generatedAt: new Date(),
    filter: { from: filter.from, to: filter.to },
    totals: {
      lessonsCompleted: progress.length,
      attemptsSubmitted: attempts.length,
      activeStudents: allActiveStudents.size,
    },
    courses,
  };
}

// --- Teacher: cohort assessment outcomes --------------------------------
//
// Same formula as getAdminAssessmentOutcomesReport, scoped to one cohort's
// enrolled students on that cohort's own course. Fills the gap
// progress.ts's getTopicMasteryForCohort() deliberately doesn't cover
// (topic-level accuracy, not per-assessment score/pass-rate) — reuses the
// same assertCanManageOrTeachCourse() ownership gate, not a new one.

export interface CohortAssessmentOutcomeRow {
  assessmentId: string;
  assessmentTitle: string;
  attempts: number;
  gradedAttempts: number;
  avgScorePercent: number | null;
  passRatePercent: number | null;
}

export async function getAssessmentOutcomesForCohort(
  cohortId: string,
  actor: AuthzActor,
  filter: DateRangeFilter = {}
): Promise<CohortAssessmentOutcomeRow[]> {
  const cohort = await withRls(actorRlsCtx(actor), (tx) =>
    tx.cohort.findUnique({ where: { id: cohortId }, select: { courseId: true } })
  );
  if (!cohort) throw new Error("Cohort not found");
  await assertCanManageOrTeachCourse(cohort.courseId, actor);

  const studentIds = (
    await withRls(actorRlsCtx(actor), (tx) => tx.enrollment.findMany({ where: { cohortId }, select: { studentUserId: true } }))
  ).map((e) => e.studentUserId);
  if (studentIds.length === 0) return [];

  const submittedAt = dateRangeWhere(filter);
  const attempts = await withRls(actorRlsCtx(actor), (tx) =>
    tx.attempt.findMany({
      where: {
        studentUserId: { in: studentIds },
        status: { in: ["submitted", "graded"] },
        assessment: { courseId: cohort.courseId },
        ...(submittedAt ? { submittedAt } : {}),
      },
      select: { status: true, scorePercent: true, passed: true, assessment: { select: { id: true, title: true } } },
    })
  );

  const byAssessment = new Map<
    string,
    { title: string; attempts: number; graded: number; scoreSum: number; passedCount: number; passEligible: number }
  >();
  for (const a of attempts) {
    const id = a.assessment.id;
    let e = byAssessment.get(id);
    if (!e) {
      e = { title: a.assessment.title, attempts: 0, graded: 0, scoreSum: 0, passedCount: 0, passEligible: 0 };
      byAssessment.set(id, e);
    }
    e.attempts += 1;
    if (a.status === "graded") {
      e.graded += 1;
      e.scoreSum += a.scorePercent ?? 0;
      if (a.passed !== null) {
        e.passEligible += 1;
        if (a.passed) e.passedCount += 1;
      }
    }
  }

  return Array.from(byAssessment.entries())
    .map(([assessmentId, v]) => ({
      assessmentId,
      assessmentTitle: v.title,
      attempts: v.attempts,
      gradedAttempts: v.graded,
      avgScorePercent: v.graded > 0 ? Math.round(v.scoreSum / v.graded) : null,
      passRatePercent: v.passEligible > 0 ? Math.round((v.passedCount / v.passEligible) * 100) : null,
    }))
    .sort((a, b) => a.assessmentTitle.localeCompare(b.assessmentTitle));
}

// --- Sponsor: milestone report -------------------------------------------

export interface MilestoneReportRow {
  id: string;
  title: string;
  status: string;
  targetDate: Date | null;
  achievedAt: Date | null;
  overdue: boolean;
}

export interface MilestoneReport {
  total: number;
  planned: number;
  inProgress: number;
  achieved: number;
  missed: number;
  rows: MilestoneReportRow[];
}

/** Authorization: delegated entirely to listMilestonesForProject()'s own requireProjectSponsorAccess() — not re-checked here. */
export async function getMilestoneReport(projectId: string, actor: AuthzActor): Promise<MilestoneReport> {
  const milestones = await listMilestonesForProject(projectId, actor);
  const now = new Date();

  const rows: MilestoneReportRow[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    targetDate: m.targetDate,
    achievedAt: m.achievedAt,
    overdue: m.status !== "achieved" && m.status !== "missed" && !!m.targetDate && m.targetDate < now,
  }));

  return {
    total: rows.length,
    planned: rows.filter((r) => r.status === "planned").length,
    inProgress: rows.filter((r) => r.status === "in_progress").length,
    achieved: rows.filter((r) => r.status === "achieved").length,
    missed: rows.filter((r) => r.status === "missed").length,
    rows,
  };
}

// --- Sponsor: project metrics report (date-filtered) -----------------------

export interface ProjectMetricsReport {
  filter: { from?: Date; to?: Date };
  summary: ImpactSummaryEntry[];
  series: { label: string; value: number; unit: string | null; recordedAt: Date }[];
}

/** Authorization: delegated to listProjectMetrics()/getProjectImpactSummary()'s own requireProjectSponsorAccess() calls. */
export async function getProjectMetricsReport(
  projectId: string,
  actor: AuthzActor,
  filter: DateRangeFilter = {}
): Promise<ProjectMetricsReport> {
  const [summary, allMetrics] = await Promise.all([
    getProjectImpactSummary(projectId, actor),
    listProjectMetrics(projectId, actor),
  ]);

  const series = allMetrics
    .filter((m) => (!filter.from || m.recordedAt >= filter.from) && (!filter.to || m.recordedAt <= filter.to))
    .map((m) => ({ label: m.label, value: m.value, unit: m.unit, recordedAt: m.recordedAt }));

  return { filter: { from: filter.from, to: filter.to }, summary, series };
}

// --- Sponsor: beneficiary engagement summary (aggregate-only) --------------

const REPORTING_SYSTEM_CTX = { isSuperAdmin: true } as const;

export interface BeneficiaryEngagementSummary {
  beneficiaryCount: number;
  withEnrollmentCount: number;
  avgCompletionPercent: number | null;
  assessmentsAttempted: number;
  assessmentsPassed: number;
  passRatePercent: number | null;
}

/**
 * Aggregate-only counts for a project's beneficiary users — NEVER a
 * per-student row, name, or score. Mirrors src/lib/sponsor.ts's
 * listProjectBeneficiaries()/getProjectBeneficiaryCount() privacy shape
 * exactly: requireProjectSponsorAccess() confirms the caller is authorized
 * for THIS project first, and only then does the Education Core read run
 * under an elevated context (a plain SPONSOR_ADMIN/SPONSOR_USER actor has
 * no RLS visibility into enrollments/lesson_progress/attempts at all — see
 * education_core/progress_lesson_completion/assessment_core's RLS
 * policies, self-or-teacher-or-courses.manage only). The elevated read is
 * scoped to exactly the beneficiary user ids already confirmed to belong to
 * this project, and the only values returned are rounded counts/
 * percentages — no note, message, or raw identity ever crosses this
 * boundary.
 *
 * KNOWN LIMITATION (see docs/REPORTING.md): Sponsor Core has no
 * Project<->Course link, so this is a PLATFORM-WIDE aggregate over the
 * beneficiary's own enrollments, not scoped to "courses this project
 * funds." If a future session adds that link, this function should be
 * narrowed to use it — reported here rather than invented unilaterally, per
 * CLAUDE_BUILD_RULES.md §2.
 */
export async function getBeneficiaryEngagementSummary(
  projectId: string,
  actor: AuthzActor
): Promise<BeneficiaryEngagementSummary> {
  await requireProjectSponsorAccess(projectId, actor);

  const memberships = await withRls(actorRlsCtx(actor), (tx) =>
    tx.projectMembership.findMany({ where: { projectId, role: "beneficiary" }, select: { userId: true } })
  );
  const beneficiaryIds = memberships.map((m) => m.userId);
  if (beneficiaryIds.length === 0) {
    return {
      beneficiaryCount: 0,
      withEnrollmentCount: 0,
      avgCompletionPercent: null,
      assessmentsAttempted: 0,
      assessmentsPassed: 0,
      passRatePercent: null,
    };
  }

  const { enrollments, publishedByCourse, completedByStudentCourse, attempts } = await withRls(
    REPORTING_SYSTEM_CTX,
    async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { studentUserId: { in: beneficiaryIds }, status: { in: ["active", "completed"] } },
        select: { studentUserId: true, cohort: { select: { courseId: true } } },
      });
      const courseIds = Array.from(new Set(enrollments.map((e) => e.cohort.courseId)));

      const lessonCounts = courseIds.length
        ? await tx.lesson.groupBy({ by: ["courseId"], where: { status: "published", courseId: { in: courseIds } }, _count: { _all: true } })
        : [];
      const publishedByCourse = new Map(lessonCounts.map((l) => [l.courseId, l._count._all]));

      const progressRows = courseIds.length
        ? await tx.lessonProgress.findMany({
            where: { studentUserId: { in: beneficiaryIds }, courseId: { in: courseIds } },
            select: { studentUserId: true, courseId: true },
          })
        : [];
      const completedByStudentCourse = new Map<string, number>();
      for (const p of progressRows) {
        const key = `${p.studentUserId}:${p.courseId}`;
        completedByStudentCourse.set(key, (completedByStudentCourse.get(key) ?? 0) + 1);
      }

      const attempts = await tx.attempt.findMany({
        where: { studentUserId: { in: beneficiaryIds }, status: "graded" },
        select: { studentUserId: true, passed: true },
      });

      return { enrollments, publishedByCourse, completedByStudentCourse, attempts };
    }
  );

  const studentsWithEnrollment = new Set(enrollments.map((e) => e.studentUserId));

  let ratioSum = 0;
  let ratioCount = 0;
  for (const e of enrollments) {
    const total = publishedByCourse.get(e.cohort.courseId) ?? 0;
    if (total === 0) continue;
    const completed = completedByStudentCourse.get(`${e.studentUserId}:${e.cohort.courseId}`) ?? 0;
    ratioSum += completed / total;
    ratioCount += 1;
  }

  const passEligible = attempts.filter((a) => a.passed !== null);
  const assessmentsPassed = passEligible.filter((a) => a.passed).length;

  return {
    beneficiaryCount: beneficiaryIds.length,
    withEnrollmentCount: studentsWithEnrollment.size,
    avgCompletionPercent: ratioCount > 0 ? Math.round((ratioSum / ratioCount) * 100) : null,
    assessmentsAttempted: attempts.length,
    assessmentsPassed,
    passRatePercent: passEligible.length > 0 ? Math.round((assessmentsPassed / passEligible.length) * 100) : null,
  };
}

// --- Export / report generation contract ------------------------------

export interface CsvColumn<T> {
  key: keyof T;
  header: string;
}

/**
 * The export/report-generation contract (PLATFORM_ARCHITECTURE.md's
 * Reporting module owns "export/report generation"): every flat report row
 * type above (CourseCompletionRow, AssessmentOutcomeRow,
 * CourseParticipationRow, MilestoneReportRow, ProjectMetricsReport.series
 * entries, ...) serializes the same way — an array of rows plus a
 * {key, header} column list — instead of each report inventing its own
 * formatter. A future export format (PDF/XLSX) or a future report type
 * should implement against this same shape, not a parallel one. Route
 * handlers under each portal's own subdomain call this and return
 * `text/csv` with a Content-Disposition download header, the same
 * "Route Handlers aren't wrapped by their segment's layout guard, re-check
 * auth in the handler itself" convention Session 13's asset downloads use.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escape(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}
