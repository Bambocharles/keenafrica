import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the student_workspace migration's RLS policies (student_notes,
 * bookmarks) are enforced by Postgres itself, against the real
 * non-superuser portal_rls_test role — see src/lib/rls.integration.test.ts's
 * header comment for why this matters (the default local dev DATABASE_URL
 * connects as the superuser, which always bypasses RLS regardless of
 * policy — see notes.ts/bookmarks.ts's updateNote/removeBookmark comments
 * for a concrete case this exact gap caused during this session).
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Student Workspace Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', '[]', true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      return fn(tx);
    });
  }

  let teacher: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };
  let courseId: string;
  let cohortId: string;
  let lessonId: string;
  let noteId: string;
  let bookmarkId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `sw-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    teacher = await mk("teacher");
    studentA = await mk("student-a");
    studentB = await mk("student-b");

    const course = await setup.course.create({
      data: { title: "SW RLS Course", createdBy: teacher.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    courseId = course.id;
    const cohort = await setup.cohort.create({ data: { courseId, name: "SW RLS Cohort" }, select: { id: true } });
    cohortId = cohort.id;
    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: studentA.id, status: "active" } });

    const module = await setup.module.create({
      data: { courseId, title: "SW RLS Module", order: 0, status: "published" },
      select: { id: true },
    });
    const lesson = await setup.lesson.create({
      data: { moduleId: module.id, courseId, title: "SW RLS Lesson", content: "body", order: 0, status: "published" },
      select: { id: true },
    });
    lessonId = lesson.id;

    const note = await setup.studentNote.create({
      data: { studentUserId: studentA.id, courseId, targetType: "course", targetId: courseId, body: "private note" },
      select: { id: true },
    });
    noteId = note.id;

    const bookmark = await setup.bookmark.create({
      data: { studentUserId: studentA.id, courseId, targetType: "lesson", targetId: lessonId },
      select: { id: true },
    });
    bookmarkId = bookmark.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.bookmark.deleteMany({ where: { courseId } });
    await setup.studentNote.deleteMany({ where: { courseId } });
    await setup.lesson.deleteMany({ where: { courseId } });
    await setup.module.deleteMany({ where: { courseId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({ where: { id: { in: [teacher.id, studentA.id, studentB.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("student_notes_select: the owning student sees their note; a different student sees nothing", async () => {
    const own = await asContext({ userId: studentA.id }, (tx) => tx.studentNote.findMany({ where: { id: noteId } }));
    expect(own).toHaveLength(1);

    const other = await asContext({ userId: studentB.id }, (tx) => tx.studentNote.findMany({ where: { id: noteId } }));
    expect(other).toHaveLength(0);
  });

  it("student_notes_select: the course's own teacher sees nothing — notes are private, not course content", async () => {
    const rows = await asContext({ userId: teacher.id }, (tx) => tx.studentNote.findMany({ where: { id: noteId } }));
    expect(rows).toHaveLength(0);
  });

  it("student_notes_update/delete: a different student's UPDATE/DELETE affects zero rows", async () => {
    await expect(
      asContext({ userId: studentB.id }, (tx) =>
        tx.studentNote.update({ where: { id: noteId }, data: { body: "tampered" } })
      )
    ).rejects.toThrow();
    await expect(
      asContext({ userId: studentB.id }, (tx) => tx.studentNote.delete({ where: { id: noteId } }))
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const stillThere = await setup.studentNote.findUnique({ where: { id: noteId } });
    expect(stillThere?.body).toBe("private note");
    await setup.$disconnect();
  });

  it("student_notes_write: a student can only INSERT a note with their own student_user_id", async () => {
    await expect(
      asContext({ userId: studentB.id }, (tx) =>
        tx.studentNote.create({
          data: { studentUserId: studentA.id, courseId, targetType: "course", targetId: courseId, body: "forged" },
        })
      )
    ).rejects.toThrow();

    const created = await asContext({ userId: studentB.id }, (tx) =>
      tx.studentNote.create({
        data: { studentUserId: studentB.id, courseId, targetType: "course", targetId: courseId, body: "genuine" },
      })
    );
    expect(created.studentUserId).toBe(studentB.id);

    const cleanup = new PrismaClient();
    await cleanup.studentNote.delete({ where: { id: created.id } });
    await cleanup.$disconnect();
  });

  it("bookmarks_select: the owning student sees their bookmark; a different student sees nothing", async () => {
    const own = await asContext({ userId: studentA.id }, (tx) => tx.bookmark.findMany({ where: { id: bookmarkId } }));
    expect(own).toHaveLength(1);

    const other = await asContext({ userId: studentB.id }, (tx) => tx.bookmark.findMany({ where: { id: bookmarkId } }));
    expect(other).toHaveLength(0);
  });

  it("bookmarks_delete: a different student's DELETE affects zero rows", async () => {
    await expect(
      asContext({ userId: studentB.id }, (tx) => tx.bookmark.delete({ where: { id: bookmarkId } }))
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const stillThere = await setup.bookmark.findUnique({ where: { id: bookmarkId } });
    expect(stillThere).not.toBeNull();
    await setup.$disconnect();
  });

  it("super_admin bypasses both tables", async () => {
    const notes = await asContext({ isSuperAdmin: true }, (tx) => tx.studentNote.findMany({ where: { id: noteId } }));
    expect(notes).toHaveLength(1);
    const bookmarks = await asContext({ isSuperAdmin: true }, (tx) => tx.bookmark.findMany({ where: { id: bookmarkId } }));
    expect(bookmarks).toHaveLength(1);
  });
});
