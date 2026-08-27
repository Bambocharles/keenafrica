import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import { createQuestion } from "@/lib/questions";
import { addQuestionToAssessment, assignAssessmentToCohort, createAssessment, publishAssessment } from "@/lib/assessments";
import { getAttemptForStudent, startAttempt, submitAttempt } from "@/lib/attempts";
import { markLessonComplete } from "@/lib/progress";
import { addProjectBeneficiary, createMilestone, createProject, createSponsor, recordProjectMetric, updateMilestone } from "@/lib/sponsor";
import {
  getAdminAssessmentOutcomesReport,
  getAdminCompletionReport,
  getAdminParticipationReport,
  getAssessmentOutcomesForCohort,
  getBeneficiaryEngagementSummary,
  getMilestoneReport,
  getProjectMetricsReport,
  toCsv,
} from "@/lib/reporting";
import {
  actorFromUser,
  cleanupTestCourses,
  cleanupTestProjects,
  cleanupTestSponsors,
  cleanupTestUsers,
  createTestUser,
} from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdProjectIds: string[] = [];
const createdSponsorIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

let slugCounter = 0;
function uniqueSlug(): string {
  slugCounter += 1;
  return `rep-test-${Date.now()}-${slugCounter}`;
}

afterAll(async () => {
  await cleanupTestProjects(createdProjectIds);
  await cleanupTestSponsors(createdSponsorIds);
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

/**
 * Course with 1 published lesson + 1 graded, passable assessment (single
 * question, passingScorePercent=50), one teacher, one cohort. Mirrors
 * progress.test.ts's setupCourseWithLessons/setupCourseWithMastery shape.
 */
async function setupReportingFixture() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Report Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  const module = await createModule(course.id, { title: "Module 1" }, teacherActor);
  await publishModule(module.id, teacherActor);
  const lesson = await createLesson(module.id, { title: "Lesson A", content: "..." }, teacherActor);
  await publishLesson(lesson.id, teacherActor);

  const assessment = await createAssessment(course.id, { title: "Quiz", passingScorePercent: 50 }, teacherActor);
  const question = await createQuestion(
    course.id,
    { type: "single_choice", prompt: "1+1?", options: [{ text: "2", isCorrect: true }, { text: "3", isCorrect: false }] },
    teacherActor
  );
  await addQuestionToAssessment(assessment.id, question.id, { points: 1 }, teacherActor);
  await publishAssessment(assessment.id, teacherActor);
  await assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor);

  return { admin, adminActor, course, cohort, module, lesson, teacher, teacherActor, assessment, question };
}

async function enrolledStudent(cohortId: string, adminActor: Awaited<ReturnType<typeof actorFromUser>>) {
  const student = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohortId, student.id, adminActor);
  const studentActor = await actorFromUser(student.id);
  return { student, studentActor };
}

async function submitCorrectAttempt(assessmentId: string, questionId: string, studentActor: Awaited<ReturnType<typeof actorFromUser>>) {
  const attempt = await startAttempt(assessmentId, studentActor);
  const view = await getAttemptForStudent(attempt.id, studentActor);
  const correctOptionId = view!.questions[0].options.find((o) => o.text === "2")!.id;
  return submitAttempt(attempt.id, [{ questionId, selectedOptionIds: [correctOptionId] }], studentActor);
}

async function submitWrongAttempt(assessmentId: string, questionId: string, studentActor: Awaited<ReturnType<typeof actorFromUser>>) {
  const attempt = await startAttempt(assessmentId, studentActor);
  const view = await getAttemptForStudent(attempt.id, studentActor);
  const wrongOptionId = view!.questions[0].options.find((o) => o.text === "3")!.id;
  return submitAttempt(attempt.id, [{ questionId, selectedOptionIds: [wrongOptionId] }], studentActor);
}

describe("getAdminCompletionReport", () => {
  it("requires courses.manage / super_admin", async () => {
    const stranger = await user({ roles: ["STUDENT"] });
    const strangerActor = await actorFromUser(stranger.id);
    await expect(getAdminCompletionReport(strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("computes per-course enrollment/completion counts across all students", async () => {
    const { course, cohort, adminActor, lesson } = await setupReportingFixture();
    const { student: s1, studentActor: s1Actor } = await enrolledStudent(cohort.id, adminActor);
    await enrolledStudent(cohort.id, adminActor); // s2 stays active/incomplete

    await markLessonComplete(course.id, lesson.id, s1Actor);

    const report = await getAdminCompletionReport(adminActor, { courseId: course.id });
    expect(report.totals.enrollments).toBe(2);
    expect(report.totals.completed).toBe(1);
    expect(report.totals.completionRatePercent).toBe(50);
    const row = report.courses.find((c) => c.courseId === course.id)!;
    expect(row.enrollments).toBe(2);
    expect(row.completed).toBe(1);
    expect(row.active).toBe(1);
    void s1;
  });
});

describe("getAdminAssessmentOutcomesReport", () => {
  it("computes avg score / pass rate over graded attempts only", async () => {
    const { course, cohort, adminActor, assessment, question } = await setupReportingFixture();
    const { studentActor: s1Actor } = await enrolledStudent(cohort.id, adminActor);
    const { studentActor: s2Actor } = await enrolledStudent(cohort.id, adminActor);

    await submitCorrectAttempt(assessment.id, question.id, s1Actor);
    await submitWrongAttempt(assessment.id, question.id, s2Actor);

    const report = await getAdminAssessmentOutcomesReport(adminActor, { courseId: course.id });
    expect(report.totals.attempts).toBe(2);
    expect(report.totals.gradedAttempts).toBe(2);
    expect(report.totals.avgScorePercent).toBe(50);
    expect(report.totals.passRatePercent).toBe(50);
    const row = report.assessments.find((a) => a.assessmentId === assessment.id)!;
    expect(row.attempts).toBe(2);
    expect(row.passRatePercent).toBe(50);
  });

  it("date range filter excludes attempts submitted outside the window", async () => {
    const { course, cohort, adminActor, assessment, question } = await setupReportingFixture();
    const { studentActor } = await enrolledStudent(cohort.id, adminActor);
    await submitCorrectAttempt(assessment.id, question.id, studentActor);

    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const report = await getAdminAssessmentOutcomesReport(adminActor, { courseId: course.id, from: farFuture });
    expect(report.totals.attempts).toBe(0);
    expect(report.assessments).toHaveLength(0);
  });
});

describe("getAdminParticipationReport", () => {
  it("counts distinct active students from lesson completion + attempt submission", async () => {
    const { course, cohort, adminActor, lesson, assessment, question } = await setupReportingFixture();
    const { studentActor: s1Actor } = await enrolledStudent(cohort.id, adminActor);
    const { studentActor: s2Actor } = await enrolledStudent(cohort.id, adminActor);

    await markLessonComplete(course.id, lesson.id, s1Actor);
    await submitCorrectAttempt(assessment.id, question.id, s2Actor);

    const report = await getAdminParticipationReport(adminActor);
    const row = report.courses.find((c) => c.courseId === course.id)!;
    expect(row.lessonsCompleted).toBeGreaterThanOrEqual(1);
    expect(row.attemptsSubmitted).toBeGreaterThanOrEqual(1);
    expect(row.activeStudents).toBeGreaterThanOrEqual(2);
  });
});

describe("getAssessmentOutcomesForCohort — teacher ownership boundary", () => {
  it("an outsider teacher cannot read cohort assessment outcomes", async () => {
    const { cohort } = await setupReportingFixture();
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(getAssessmentOutcomesForCohort(cohort.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("the assigned teacher sees the cohort's own assessment outcomes", async () => {
    const { cohort, adminActor, teacherActor, assessment, question } = await setupReportingFixture();
    const { studentActor } = await enrolledStudent(cohort.id, adminActor);
    await submitCorrectAttempt(assessment.id, question.id, studentActor);

    const rows = await getAssessmentOutcomesForCohort(cohort.id, teacherActor);
    expect(rows).toHaveLength(1);
    expect(rows[0].assessmentId).toBe(assessment.id);
    expect(rows[0].passRatePercent).toBe(100);
  });
});

async function makeSponsorProject() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const sponsor = await createSponsor(`Sponsor ${uniqueSlug()}`, adminActor);
  createdSponsorIds.push(sponsor.id);
  const project = await createProject({ sponsorId: sponsor.id, name: "Report Project", slug: uniqueSlug() }, adminActor);
  createdProjectIds.push(project.id);
  return { admin, adminActor, sponsor, project };
}

describe("getMilestoneReport", () => {
  it("buckets by status and flags overdue non-achieved milestones", async () => {
    const { adminActor, project } = await makeSponsorProject();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const overdueMilestone = await createMilestone(project.id, { title: "Late one", targetDate: past }, adminActor);
    await createMilestone(project.id, { title: "On track", targetDate: future }, adminActor);
    const achieved = await createMilestone(project.id, { title: "Done", targetDate: past }, adminActor);
    await updateMilestone(achieved.id, { status: "achieved" }, adminActor);

    const report = await getMilestoneReport(project.id, adminActor);
    expect(report.total).toBe(3);
    expect(report.achieved).toBe(1);
    expect(report.planned).toBe(2);
    const overdueRow = report.rows.find((r) => r.id === overdueMilestone.id)!;
    expect(overdueRow.overdue).toBe(true);
    const achievedRow = report.rows.find((r) => r.id === achieved.id)!;
    expect(achievedRow.overdue).toBe(false);
  });

  it("an outsider (non-sponsor-team, non-admin) cannot read the milestone report", async () => {
    const { project } = await makeSponsorProject();
    const outsider = await user({ roles: ["SPONSOR_USER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(getMilestoneReport(project.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("getProjectMetricsReport", () => {
  it("filters the time series by recordedAt while summary stays the latest-per-label", async () => {
    const { adminActor, project } = await makeSponsorProject();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const recent = new Date();

    await recordProjectMetric(project.id, { label: "Beneficiaries reached", value: 50, recordedAt: old }, adminActor);
    await recordProjectMetric(project.id, { label: "Beneficiaries reached", value: 120, recordedAt: recent }, adminActor);

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const report = await getProjectMetricsReport(project.id, adminActor, { from: fiveDaysAgo });
    expect(report.series).toHaveLength(1);
    expect(report.series[0].value).toBe(120);
    expect(report.summary.find((s) => s.label === "Beneficiaries reached")?.sampleCount).toBe(2);
  });
});

describe("getBeneficiaryEngagementSummary", () => {
  it("returns aggregate-only counts (never a per-student row) over the beneficiary's own enrollment/attempt evidence", async () => {
    const { adminActor, project } = await makeSponsorProject();
    const { course, cohort, lesson, assessment, question } = await setupReportingFixture();

    const { student, studentActor } = await enrolledStudent(cohort.id, adminActor);
    await markLessonComplete(course.id, lesson.id, studentActor);
    await submitCorrectAttempt(assessment.id, question.id, studentActor);
    await addProjectBeneficiary(project.id, student.email, adminActor);

    const summary = await getBeneficiaryEngagementSummary(project.id, adminActor);
    expect(summary.beneficiaryCount).toBe(1);
    expect(summary.withEnrollmentCount).toBe(1);
    expect(summary.avgCompletionPercent).toBe(100); // the course's one published lesson, completed
    expect(summary.assessmentsAttempted).toBe(1);
    expect(summary.assessmentsPassed).toBe(1);
    expect(summary.passRatePercent).toBe(100);
    expect(summary).not.toHaveProperty("students");
    expect(summary).not.toHaveProperty("beneficiaries");
  });

  it("zero beneficiaries returns an all-zero/null summary, not an error", async () => {
    const { adminActor, project } = await makeSponsorProject();
    const summary = await getBeneficiaryEngagementSummary(project.id, adminActor);
    expect(summary.beneficiaryCount).toBe(0);
    expect(summary.avgCompletionPercent).toBeNull();
  });

  it("a non-sponsor-team outsider cannot read the beneficiary engagement summary", async () => {
    const { project } = await makeSponsorProject();
    const outsider = await user({ roles: ["SPONSOR_USER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(getBeneficiaryEngagementSummary(project.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("toCsv", () => {
  it("serializes rows with a header and quotes fields containing commas/quotes", () => {
    const rows = [
      { name: "Plain", value: 1 },
      { name: "Has, comma", value: 2 },
      { name: 'Has "quote"', value: 3 },
    ];
    const csv = toCsv(rows, [
      { key: "name", header: "Name" },
      { key: "value", header: "Value" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Name,Value");
    expect(lines[1]).toBe("Plain,1");
    expect(lines[2]).toBe('"Has, comma",2');
    expect(lines[3]).toBe('"Has ""quote""",3');
  });

  it("renders null/undefined as an empty field", () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ]);
    expect(csv).toBe("A,B\n,");
  });
});
