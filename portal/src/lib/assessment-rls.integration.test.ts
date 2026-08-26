import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the assessment_core migration's RLS policies are enforced by
 * Postgres itself, against the real non-superuser portal_rls_test role —
 * see src/lib/rls.integration.test.ts's header comment for why this
 * matters. Specifically targets the two properties the migration's design
 * note calls out: (1) questions/question_options (the bank's answer key)
 * are NEVER directly SELECT-able by a student, only reachable through the
 * application's redacted attempt view; (2) a student can only ever read
 * their OWN attempt/answer rows, and only assessment_versions rows they
 * have an attempt against.
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Assessment Core Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean; permissions?: string[] },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      return fn(tx);
    });
  }

  let admin: { id: string };
  let teacher: { id: string };
  let outsiderTeacher: { id: string };
  let student: { id: string };
  let outsiderStudent: { id: string };
  let courseId: string;
  let cohortId: string;
  let questionId: string;
  let correctOptionId: string;
  let assessmentId: string;
  let versionId: string;
  let attemptId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({ data: { email: `asm-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" }, select: { id: true } });
    admin = await mk("admin");
    teacher = await mk("teacher");
    outsiderTeacher = await mk("outsider-teacher");
    student = await mk("student");
    outsiderStudent = await mk("outsider-student");

    const course = await setup.course.create({ data: { title: "RLS Assessment Course", createdBy: admin.id, status: "published", publishedAt: new Date() }, select: { id: true } });
    courseId = course.id;
    const cohort = await setup.cohort.create({ data: { courseId, name: "RLS Cohort" }, select: { id: true } });
    cohortId = cohort.id;
    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: student.id, status: "active" } });

    const question = await setup.question.create({
      data: { courseId, type: "single_choice", prompt: "2+2?", createdBy: teacher.id },
      select: { id: true },
    });
    questionId = question.id;
    const wrongOption = await setup.questionOption.create({ data: { questionId, text: "3", isCorrect: false, order: 0 }, select: { id: true } });
    const correctOption = await setup.questionOption.create({ data: { questionId, text: "4", isCorrect: true, order: 1 }, select: { id: true } });
    correctOptionId = correctOption.id;
    void wrongOption;

    const assessment = await setup.assessment.create({
      data: { courseId, title: "RLS Quiz", status: "published", version: 1, createdBy: teacher.id, publishedAt: new Date() },
      select: { id: true },
    });
    assessmentId = assessment.id;
    await setup.assessmentQuestion.create({ data: { assessmentId, questionId, order: 0, points: 1 } });

    const version = await setup.assessmentVersion.create({
      data: {
        assessmentId,
        version: 1,
        title: "RLS Quiz",
        instructions: "",
        questions: [
          {
            questionId,
            order: 0,
            points: 1,
            type: "single_choice",
            prompt: "2+2?",
            explanation: "Basic arithmetic",
            difficulty: "easy",
            learningObjective: "",
            options: [
              { id: wrongOption.id, text: "3", isCorrect: false, order: 0 },
              { id: correctOptionId, text: "4", isCorrect: true, order: 1 },
            ],
            acceptableAnswers: null,
          },
        ],
        publishedBy: teacher.id,
      },
      select: { id: true },
    });
    versionId = version.id;

    await setup.assessmentAssignment.create({ data: { assessmentId, courseId, scope: "cohort", cohortId, createdBy: teacher.id } });

    const attempt = await setup.attempt.create({
      data: { assessmentId, assessmentVersionId: versionId, studentUserId: student.id, attemptNumber: 1 },
      select: { id: true },
    });
    attemptId = attempt.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.answer.deleteMany({ where: { attemptId } });
    await setup.attempt.deleteMany({ where: { assessmentId } });
    await setup.assessmentAssignment.deleteMany({ where: { assessmentId } });
    await setup.assessmentVersion.deleteMany({ where: { assessmentId } });
    await setup.assessmentQuestion.deleteMany({ where: { assessmentId } });
    await setup.assessment.deleteMany({ where: { id: assessmentId } });
    await setup.questionOption.deleteMany({ where: { questionId } });
    await setup.question.deleteMany({ where: { id: questionId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({ where: { id: { in: [admin.id, teacher.id, outsiderTeacher.id, student.id, outsiderStudent.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("questions_select: a student can NEVER select a bank question directly, even one on an assessment they're attempting", async () => {
    const rows = await asContext({ userId: student.id }, (tx) => tx.question.findMany({ where: { id: questionId } }));
    expect(rows).toHaveLength(0);
  });

  it("question_options_select: a student can NEVER select the answer key directly", async () => {
    const rows = await asContext({ userId: student.id }, (tx) => tx.questionOption.findMany({ where: { questionId } }));
    expect(rows).toHaveLength(0);
  });

  it("questions_select: the assigned teacher can see the question; an outsider teacher (even with courses.content.write) cannot", async () => {
    const teacherRows = await asContext({ userId: teacher.id, permissions: ["courses.content.write"] }, (tx) => tx.question.findMany({ where: { id: questionId } }));
    expect(teacherRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderTeacher.id, permissions: ["courses.content.write"] }, (tx) => tx.question.findMany({ where: { id: questionId } }));
    expect(outsiderRows).toHaveLength(0);
  });

  it("assessments_select: an assigned+enrolled student sees the published assessment; an outsider student sees nothing", async () => {
    const studentRows = await asContext({ userId: student.id }, (tx) => tx.assessment.findMany({ where: { id: assessmentId } }));
    expect(studentRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderStudent.id }, (tx) => tx.assessment.findMany({ where: { id: assessmentId } }));
    expect(outsiderRows).toHaveLength(0);
  });

  it("assessment_versions_select: the student sees the version through their own attempt; an outsider student does not", async () => {
    const studentRows = await asContext({ userId: student.id }, (tx) => tx.assessmentVersion.findMany({ where: { id: versionId } }));
    expect(studentRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderStudent.id }, (tx) => tx.assessmentVersion.findMany({ where: { id: versionId } }));
    expect(outsiderRows).toHaveLength(0);
  });

  it("assessment_versions: append-only — nobody, not even super_admin, can UPDATE or DELETE a published snapshot", async () => {
    await expect(
      asContext({ isSuperAdmin: true }, (tx) => tx.assessmentVersion.update({ where: { id: versionId }, data: { title: "tampered" } }))
    ).rejects.toThrow();
    await expect(asContext({ isSuperAdmin: true }, (tx) => tx.assessmentVersion.delete({ where: { id: versionId } }))).rejects.toThrow();
  });

  it("attempts_select: a student sees only their own attempt; an outsider student sees none; the course teacher sees it", async () => {
    const ownRows = await asContext({ userId: student.id }, (tx) => tx.attempt.findMany({ where: { id: attemptId } }));
    expect(ownRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderStudent.id }, (tx) => tx.attempt.findMany({ where: { id: attemptId } }));
    expect(outsiderRows).toHaveLength(0);

    const teacherRows = await asContext({ userId: teacher.id }, (tx) => tx.attempt.findMany({ where: { id: attemptId } }));
    expect(teacherRows).toHaveLength(1);

    const outsiderTeacherRows = await asContext({ userId: outsiderTeacher.id }, (tx) => tx.attempt.findMany({ where: { id: attemptId } }));
    expect(outsiderTeacherRows).toHaveLength(0);
  });

  it("attempts_write: a student cannot INSERT an attempt row for another student", async () => {
    await expect(
      asContext({ userId: outsiderStudent.id }, (tx) =>
        tx.attempt.create({ data: { assessmentId, assessmentVersionId: versionId, studentUserId: student.id, attemptNumber: 99 } })
      )
    ).rejects.toThrow();
  });

  it("attempts: no DELETE policy exists at all — a submitted/graded attempt is permanent", async () => {
    await expect(asContext({ isSuperAdmin: true }, (tx) => tx.attempt.delete({ where: { id: attemptId } }))).rejects.toThrow();
  });

  it("answers_select: a student sees their own answer via their attempt; an outsider student sees none", async () => {
    const setup = new PrismaClient();
    const answer = await setup.answer.create({
      data: { attemptId, questionId, selectedOptionIds: [correctOptionId], isCorrect: true, awardedPoints: 1 },
      select: { id: true },
    });
    await setup.$disconnect();

    const ownRows = await asContext({ userId: student.id }, (tx) => tx.answer.findMany({ where: { id: answer.id } }));
    expect(ownRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderStudent.id }, (tx) => tx.answer.findMany({ where: { id: answer.id } }));
    expect(outsiderRows).toHaveLength(0);

    const teacherRows = await asContext({ userId: teacher.id }, (tx) => tx.answer.findMany({ where: { id: answer.id } }));
    expect(teacherRows).toHaveLength(1);
  });
});
