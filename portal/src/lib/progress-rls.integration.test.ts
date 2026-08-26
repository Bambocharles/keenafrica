import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the progress_lesson_completion migration's RLS policies
 * (lesson_progress) are enforced by Postgres itself, against the real
 * non-superuser portal_rls_test role — see src/lib/rls.integration.test.ts's
 * header comment for why this matters (the default local dev DATABASE_URL
 * connects as the superuser, which always bypasses RLS regardless of
 * policy).
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Progress Row-Level Security (enforced by a non-superuser role)", () => {
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

  let teacher: { id: string };
  let outsiderTeacher: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };
  let courseId: string;
  let cohortId: string;
  let lessonId: string;
  let progressId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `progress-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    teacher = await mk("teacher");
    outsiderTeacher = await mk("outsider-teacher");
    studentA = await mk("student-a");
    studentB = await mk("student-b");

    const course = await setup.course.create({
      data: { title: "Progress RLS Course", createdBy: teacher.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    courseId = course.id;
    const cohort = await setup.cohort.create({ data: { courseId, name: "Progress RLS Cohort" }, select: { id: true } });
    cohortId = cohort.id;
    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: studentA.id, status: "active" } });

    const module = await setup.module.create({
      data: { courseId, title: "Progress RLS Module", order: 0, status: "published" },
      select: { id: true },
    });
    const lesson = await setup.lesson.create({
      data: { moduleId: module.id, courseId, title: "Progress RLS Lesson", content: "body", order: 0, status: "published" },
      select: { id: true },
    });
    lessonId = lesson.id;

    const progress = await setup.lessonProgress.create({
      data: { studentUserId: studentA.id, lessonId, courseId },
      select: { id: true },
    });
    progressId = progress.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.lessonProgress.deleteMany({ where: { courseId } });
    await setup.lesson.deleteMany({ where: { courseId } });
    await setup.module.deleteMany({ where: { courseId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({ where: { id: { in: [teacher.id, outsiderTeacher.id, studentA.id, studentB.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("lesson_progress_select: the owning student sees their row; a different student sees nothing", async () => {
    const own = await asContext({ userId: studentA.id }, (tx) => tx.lessonProgress.findMany({ where: { id: progressId } }));
    expect(own).toHaveLength(1);

    const other = await asContext({ userId: studentB.id }, (tx) => tx.lessonProgress.findMany({ where: { id: progressId } }));
    expect(other).toHaveLength(0);
  });

  it("lesson_progress_select: the course's teacher (via cohort_teachers) sees it; an outsider teacher does not", async () => {
    const teacherRows = await asContext({ userId: teacher.id }, (tx) => tx.lessonProgress.findMany({ where: { id: progressId } }));
    expect(teacherRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderTeacher.id }, (tx) => tx.lessonProgress.findMany({ where: { id: progressId } }));
    expect(outsiderRows).toHaveLength(0);
  });

  it("lesson_progress_write: a student can only INSERT their own completion, not forge one for another student", async () => {
    await expect(
      asContext({ userId: studentB.id }, (tx) =>
        tx.lessonProgress.create({ data: { studentUserId: studentA.id, lessonId, courseId } })
      )
    ).rejects.toThrow();

    const created = await asContext({ userId: studentB.id }, (tx) =>
      tx.lessonProgress.create({ data: { studentUserId: studentB.id, lessonId, courseId } })
    );
    expect(created.studentUserId).toBe(studentB.id);

    const cleanup = new PrismaClient();
    await cleanup.lessonProgress.delete({ where: { id: created.id } });
    await cleanup.$disconnect();
  });

  it("append-only: nobody, not even super_admin or courses.manage, can UPDATE or DELETE a recorded completion", async () => {
    await expect(
      asContext({ isSuperAdmin: true }, (tx) =>
        tx.lessonProgress.update({ where: { id: progressId }, data: { completedAt: new Date(0) } })
      )
    ).rejects.toThrow();
    await expect(
      asContext({ isSuperAdmin: true }, (tx) => tx.lessonProgress.delete({ where: { id: progressId } }))
    ).rejects.toThrow();
    await expect(
      asContext({ userId: studentA.id, permissions: ["courses.manage"] }, (tx) =>
        tx.lessonProgress.update({ where: { id: progressId }, data: { completedAt: new Date(0) } })
      )
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const stillThere = await setup.lessonProgress.findUnique({ where: { id: progressId } });
    expect(stillThere).not.toBeNull();
    await setup.$disconnect();
  });

  it("courses.manage bypasses SELECT the same way super_admin does", async () => {
    const rows = await asContext({ permissions: ["courses.manage"] }, (tx) => tx.lessonProgress.findMany({ where: { id: progressId } }));
    expect(rows).toHaveLength(1);
  });
});
