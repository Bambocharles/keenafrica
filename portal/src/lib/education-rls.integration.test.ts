import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the education_core migration's RLS policies are enforced by
 * Postgres itself, against the real non-superuser portal_rls_test role —
 * see src/lib/rls.integration.test.ts's header comment for why this
 * matters (the default local dev DATABASE_URL connects as the superuser,
 * which always bypasses RLS regardless of policy). This suite specifically
 * targets the "draft content is invisible to students" and "content
 * ownership is enforced" acceptance criteria at the database layer,
 * independent of the application-layer checks in courses.ts/content.ts.
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Education Core Row-Level Security (enforced by a non-superuser role)", () => {
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
  let moduleId: string;
  let draftLessonId: string;
  let publishedLessonId: string;

  beforeAll(async () => {
    // Table-owner-equivalent superuser connection for fixture setup only —
    // fixture writes here aren't subject to the RLS this suite tests.
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `edu-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    admin = await mk("admin");
    teacher = await mk("teacher");
    outsiderTeacher = await mk("outsider-teacher");
    student = await mk("student");
    outsiderStudent = await mk("outsider-student");

    const course = await setup.course.create({
      data: { title: "RLS Test Course", createdBy: admin.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    courseId = course.id;

    const cohort = await setup.cohort.create({ data: { courseId, name: "RLS Cohort" }, select: { id: true } });
    cohortId = cohort.id;

    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: student.id, status: "active" } });

    const module = await setup.module.create({
      data: { courseId, title: "RLS Module", order: 0, status: "published" },
      select: { id: true },
    });
    moduleId = module.id;

    const draftLesson = await setup.lesson.create({
      data: { moduleId, courseId, title: "Draft Lesson", content: "secret", order: 0, status: "draft" },
      select: { id: true },
    });
    draftLessonId = draftLesson.id;

    const publishedLesson = await setup.lesson.create({
      data: { moduleId, courseId, title: "Published Lesson", content: "public", order: 1, status: "published" },
      select: { id: true },
    });
    publishedLessonId = publishedLesson.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.lesson.deleteMany({ where: { courseId } });
    await setup.module.deleteMany({ where: { courseId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({
      where: { id: { in: [admin.id, teacher.id, outsiderTeacher.id, student.id, outsiderStudent.id] } },
    });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("lessons_select: a student sees only the published lesson, never the draft one", async () => {
    const rows = await asContext({ userId: student.id }, (tx) =>
      tx.lesson.findMany({ where: { id: { in: [draftLessonId, publishedLessonId] } } })
    );
    expect(rows.map((r) => r.id)).toEqual([publishedLessonId]);
  });

  it("lessons_select: an unenrolled student sees neither lesson", async () => {
    const rows = await asContext({ userId: outsiderStudent.id }, (tx) =>
      tx.lesson.findMany({ where: { id: { in: [draftLessonId, publishedLessonId] } } })
    );
    expect(rows).toHaveLength(0);
  });

  it("lessons_select: the assigned teacher sees both draft and published lessons", async () => {
    const rows = await asContext({ userId: teacher.id }, (tx) =>
      tx.lesson.findMany({ where: { id: { in: [draftLessonId, publishedLessonId] } } })
    );
    expect(rows.map((r) => r.id).sort()).toEqual([draftLessonId, publishedLessonId].sort());
  });

  it("lessons_select: a teacher with NO cohort assignment on this course sees nothing", async () => {
    const rows = await asContext({ userId: outsiderTeacher.id, permissions: ["courses.content.write"] }, (tx) =>
      tx.lesson.findMany({ where: { id: { in: [draftLessonId, publishedLessonId] } } })
    );
    expect(rows).toHaveLength(0);
  });

  it("lessons_write: an outsider teacher with courses.content.write cannot INSERT a lesson into this course", async () => {
    await expect(
      asContext({ userId: outsiderTeacher.id, permissions: ["courses.content.write"] }, (tx) =>
        tx.lesson.create({
          data: { moduleId, courseId, title: "Sneaky", content: "x", order: 99 },
        })
      )
    ).rejects.toThrow();
  });

  it("lessons_write: the assigned teacher WITH courses.content.write can INSERT; WITHOUT it cannot", async () => {
    await expect(
      asContext({ userId: teacher.id, permissions: [] }, (tx) =>
        tx.lesson.create({ data: { moduleId, courseId, title: "No Perm", content: "x", order: 98 } })
      )
    ).rejects.toThrow();

    const created = await asContext({ userId: teacher.id, permissions: ["courses.content.write"] }, (tx) =>
      tx.lesson.create({ data: { moduleId, courseId, title: "With Perm", content: "x", order: 97 } })
    );
    expect(created.courseId).toBe(courseId);

    // cleanup via superuser
    const setup = new PrismaClient();
    await setup.lesson.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });

  it("lesson_versions: append-only — select cascades through lessons' own RLS, and there is no UPDATE/DELETE policy at all", async () => {
    const setup = new PrismaClient();
    const version = await setup.lessonVersion.create({
      data: { lessonId: publishedLessonId, version: 1, title: "v1", content: "v1 body", publishedBy: teacher.id },
      select: { id: true },
    });
    await setup.$disconnect();

    // Enrolled student can see the version (published lesson cascades visible).
    const visible = await asContext({ userId: student.id }, (tx) =>
      tx.lessonVersion.findMany({ where: { id: version.id } })
    );
    expect(visible).toHaveLength(1);

    // Nobody — not even super_admin — can UPDATE or DELETE a version.
    await expect(
      asContext({ isSuperAdmin: true }, (tx) =>
        tx.lessonVersion.update({ where: { id: version.id }, data: { title: "tampered" } })
      )
    ).rejects.toThrow();
    await expect(
      asContext({ isSuperAdmin: true }, (tx) => tx.lessonVersion.delete({ where: { id: version.id } }))
    ).rejects.toThrow();

    const cleanup = new PrismaClient();
    await cleanup.lessonVersion.delete({ where: { id: version.id } });
    await cleanup.$disconnect();
  });

  it("courses_select: a student sees the published course only via their active enrollment", async () => {
    const rows = await asContext({ userId: student.id }, (tx) => tx.course.findMany({ where: { id: courseId } }));
    expect(rows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderStudent.id }, (tx) =>
      tx.course.findMany({ where: { id: courseId } })
    );
    expect(outsiderRows).toHaveLength(0);
  });

  it("topics_select: public read — even an unauthenticated context sees topic rows", async () => {
    const setup = new PrismaClient();
    const topic = await setup.topic.create({ data: { name: "RLS Topic" }, select: { id: true } });
    await setup.$disconnect();

    const rows = await asContext({}, (tx) => tx.topic.findMany({ where: { id: topic.id } }));
    expect(rows).toHaveLength(1);

    const cleanup = new PrismaClient();
    await cleanup.topic.delete({ where: { id: topic.id } });
    await cleanup.$disconnect();
  });
});
