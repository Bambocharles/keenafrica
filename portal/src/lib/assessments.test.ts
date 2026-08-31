import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { createQuestion } from "@/lib/questions";
import {
  addQuestionToAssessment,
  archiveAssessment,
  assignAssessmentToCohort,
  assignAssessmentToStudent,
  createAssessment,
  getAssessmentById,
  getAssessmentVersionById,
  getCurrentPublishedVersion,
  listAssessmentsForCourse,
  listAssignmentsForAssessment,
  listMyAssignedAssessments,
  publishAssessment,
  removeQuestionFromAssessment,
  unassignAssessment,
  updateAssessment,
} from "@/lib/assessments";
import { actorFromUser, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

async function setupCourseWithTeacherAndStudent() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  const student = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, student.id, adminActor);
  const studentActor = await actorFromUser(student.id);

  return { admin, adminActor, course, cohort, teacher, teacherActor, student, studentActor };
}

async function withOneQuestion(courseId: string, teacherActor: Awaited<ReturnType<typeof actorFromUser>>, assessmentId: string) {
  const q = await createQuestion(
    courseId,
    { type: "single_choice", prompt: "2+2?", options: [{ text: "3", isCorrect: false }, { text: "4", isCorrect: true }] },
    teacherActor
  );
  await addQuestionToAssessment(assessmentId, q.id, {}, teacherActor);
  return q;
}

describe("createAssessment / updateAssessment — ownership boundary", () => {
  it("a teacher NOT assigned to the course cannot create an assessment", async () => {
    const { course } = await setupCourseWithTeacherAndStudent();
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(createAssessment(course.id, { title: "Sneaky" }, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("the assigned teacher can create a draft assessment", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz 1", maxAttempts: 2 }, teacherActor);
    expect(assessment.status).toBe("draft");
    expect(assessment.version).toBe(0);
    expect(assessment.maxAttempts).toBe(2);
  });

  it("outsider cannot update", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(updateAssessment(assessment.id, { title: "Hacked" }, outsiderActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("publishAssessment — versioning foundation", () => {
  it("cannot publish an assessment with zero questions", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Empty" }, teacherActor);
    await expect(publishAssessment(assessment.id, teacherActor)).rejects.toThrow(/no questions/);
  });

  it("publishing snapshots the question tree into an immutable AssessmentVersion", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);

    await publishAssessment(assessment.id, teacherActor);
    const published = await getAssessmentById(assessment.id, teacherActor);
    expect(published?.status).toBe("published");
    expect(published?.version).toBe(1);

    const version = await getCurrentPublishedVersion(assessment.id, teacherActor);
    expect(version?.version).toBe(1);
    const questions = version?.questions as unknown as { prompt: string }[];
    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toBe("2+2?");
  });

  it("editing the live question list after publishing does NOT rewrite the earlier version — re-publishing creates a NEW version instead", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    const q1 = await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);
    const v1 = (await getCurrentPublishedVersion(assessment.id, teacherActor))!;
    expect((v1.questions as unknown as { prompt: string }[]).map((q) => q.prompt)).toEqual(["2+2?"]);

    // Edit the live question list: swap the question out entirely.
    const q2 = await createQuestion(course.id, { type: "short_answer", prompt: "New question" }, teacherActor);
    await addQuestionToAssessment(assessment.id, q2.id, {}, teacherActor);
    await removeQuestionFromAssessment(assessment.id, q1.id, teacherActor);

    // v1's own row, re-fetched by id, is byte-for-byte unchanged by the edit.
    const v1Refetched = await getCurrentPublishedVersion(assessment.id, teacherActor);
    expect(v1Refetched!.id).toBe(v1.id); // no republish yet -> "current" still points at v1
    expect((v1Refetched!.questions as unknown as { prompt: string }[]).map((q) => q.prompt)).toEqual(["2+2?"]);

    await publishAssessment(assessment.id, teacherActor);
    const v2 = (await getCurrentPublishedVersion(assessment.id, teacherActor))!;
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
    expect((v2.questions as unknown as { prompt: string }[]).map((q) => q.prompt)).toEqual(["New question"]);

    // v1 itself, fetched by its own id directly, still shows the original
    // question — proves the earlier snapshot was never mutated in place.
    const v1AfterRepublish = await getAssessmentVersionById(v1.id, teacherActor);
    expect((v1AfterRepublish!.questions as unknown as { prompt: string }[]).map((q) => q.prompt)).toEqual(["2+2?"]);
  });
});

describe("assignment — cohort/student, ownership + enrollment validation", () => {
  it("cannot assign a draft assessment", async () => {
    const { course, cohort, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await expect(assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor)).rejects.toThrow(/draft/);
  });

  it("outsider teacher cannot assign", async () => {
    const { course, cohort, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(assignAssessmentToCohort(assessment.id, cohort.id, {}, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("cannot assign to a student not enrolled in the course", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);

    const outsiderStudent = await user({ roles: ["STUDENT"] });
    await expect(assignAssessmentToStudent(assessment.id, outsiderStudent.id, {}, teacherActor)).rejects.toThrow(/not enrolled/);
  });

  it("assigns to a cohort and a student can discover it via listMyAssignedAssessments", async () => {
    const { course, cohort, teacherActor, studentActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);
    await assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor);

    const mine = await listMyAssignedAssessments(studentActor);
    expect(mine.map((m) => m.assessment.id)).toEqual([assessment.id]);
  });

  it("a student never assigned does not see it", async () => {
    const { course, cohort, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);
    await assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor);

    const otherStudent = await user({ roles: ["STUDENT"] });
    const otherStudentActor = await actorFromUser(otherStudent.id);
    const theirs = await listMyAssignedAssessments(otherStudentActor);
    expect(theirs).toHaveLength(0);
  });

  it("unassignAssessment removes the row; listAssignmentsForAssessment is ownership-scoped", async () => {
    const { course, cohort, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);
    const assignment = await assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor);

    const list = await listAssignmentsForAssessment(assessment.id, teacherActor);
    expect(list).toHaveLength(1);

    await unassignAssessment(assignment.id, teacherActor);
    const after = await listAssignmentsForAssessment(assessment.id, teacherActor);
    expect(after).toHaveLength(0);

    // Session 33: unassignAssessment() used to be the only deletion path in
    // the codebase for assessment_assignments with no audit trail at all —
    // found while investigating why that table turned up completely empty
    // in production with nothing in audit_events either way.
    const auditRow = await prisma.auditEvent.findFirst({
      where: { action: "assessment.unassigned", entityType: "AssessmentAssignment", entityId: assignment.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(teacherActor.id);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(listAssignmentsForAssessment(assessment.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("archiveAssessment", () => {
  it("stops it from listing as assignable status but keeps it in listAssessmentsForCourse", async () => {
    const { course, teacherActor } = await setupCourseWithTeacherAndStudent();
    const assessment = await createAssessment(course.id, { title: "Quiz" }, teacherActor);
    await withOneQuestion(course.id, teacherActor, assessment.id);
    await publishAssessment(assessment.id, teacherActor);
    await archiveAssessment(assessment.id, teacherActor);

    const found = await getAssessmentById(assessment.id, teacherActor);
    expect(found?.status).toBe("archived");

    const list = await listAssessmentsForCourse(course.id, teacherActor);
    expect(list.map((a) => a.id)).toContain(assessment.id);
  });
});
