import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Session 05 (Teacher) — proves cohort-level visibility is enforced by
 * Postgres RLS, against the real non-superuser portal_rls_test role (same
 * rationale as education-rls.integration.test.ts: the default local dev
 * DATABASE_URL is a superuser connection that always bypasses RLS, and
 * production's kf_portal_prod_app role does NOT bypass it — see
 * docs/ENVIRONMENT.md — so this is the only suite that proves what actually
 * holds in production).
 *
 * This matters specifically for src/lib/courses.ts's listCohortsForCourse()/
 * listEnrollmentsForCohort(): their APPLICATION-layer authorization check
 * (assertCanManageOrTeachCourse) is course-scoped — it only confirms the
 * actor teaches *some* cohort of the course, then queries `WHERE course_id
 * = ...` with no further cohort filter. A teacher assigned to only one of a
 * course's several cohorts could therefore call listEnrollmentsForCohort()
 * with a sibling cohort's id and the application-layer check alone would
 * not reject it. The cohorts_select/enrollments_select RLS policies (see
 * the education_core migration) are per-COHORT (`cohort_teachers.cohort_id
 * = cohorts.id`/`= enrollments.cohort_id`), not per-course, and — against
 * the real RLS-enforcing role — silently narrow the query result set to
 * only the cohort(s) the actor actually teaches. This suite proves that
 * narrowing actually happens, closing the gap the coarser application-layer
 * check alone would leave open. Skips (doesn't fail) when
 * RLS_TEST_DATABASE_URL is unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Cohort-level RLS visibility for a teacher assigned to only one of a course's cohorts", () => {
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
  let studentA: { id: string };
  let studentB: { id: string };
  let courseId: string;
  let cohortAId: string;
  let cohortBId: string;
  let enrollmentAId: string;
  let enrollmentBId: string;

  beforeAll(async () => {
    // Table-owner-equivalent superuser connection for fixture setup only.
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `teacher-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    admin = await mk("admin");
    teacher = await mk("teacher");
    studentA = await mk("student-a");
    studentB = await mk("student-b");

    const course = await setup.course.create({
      data: { title: "Cohort RLS Test Course", createdBy: admin.id },
      select: { id: true },
    });
    courseId = course.id;

    const cohortA = await setup.cohort.create({ data: { courseId, name: "Cohort A" }, select: { id: true } });
    const cohortB = await setup.cohort.create({ data: { courseId, name: "Cohort B" }, select: { id: true } });
    cohortAId = cohortA.id;
    cohortBId = cohortB.id;

    // Teacher is assigned to Cohort A only — never Cohort B.
    await setup.cohortTeacher.create({ data: { cohortId: cohortAId, teacherUserId: teacher.id } });

    const enrollmentA = await setup.enrollment.create({
      data: { cohortId: cohortAId, studentUserId: studentA.id, status: "active" },
      select: { id: true },
    });
    const enrollmentB = await setup.enrollment.create({
      data: { cohortId: cohortBId, studentUserId: studentB.id, status: "active" },
      select: { id: true },
    });
    enrollmentAId = enrollmentA.id;
    enrollmentBId = enrollmentB.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.enrollment.deleteMany({ where: { cohortId: { in: [cohortAId, cohortBId] } } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId: cohortAId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({ where: { id: { in: [admin.id, teacher.id, studentA.id, studentB.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("cohorts_select: the teacher sees Cohort A but not sibling Cohort B of the same course", async () => {
    const rows = await asContext({ userId: teacher.id }, (tx) =>
      tx.cohort.findMany({ where: { courseId } })
    );
    expect(rows.map((r) => r.id)).toEqual([cohortAId]);
  });

  it("enrollments_select: the teacher sees Cohort A's enrollment but not Cohort B's, even scoped only by courseId", async () => {
    const rows = await asContext({ userId: teacher.id }, (tx) =>
      tx.enrollment.findMany({ where: { id: { in: [enrollmentAId, enrollmentBId] } } })
    );
    expect(rows.map((r) => r.id)).toEqual([enrollmentAId]);
  });

  it("an admin (courses.manage) sees both cohorts and both enrollments", async () => {
    const cohortRows = await asContext({ userId: admin.id, permissions: ["courses.manage"] }, (tx) =>
      tx.cohort.findMany({ where: { courseId } })
    );
    expect(cohortRows.map((r) => r.id).sort()).toEqual([cohortAId, cohortBId].sort());

    const enrollmentRows = await asContext({ userId: admin.id, permissions: ["courses.manage"] }, (tx) =>
      tx.enrollment.findMany({ where: { id: { in: [enrollmentAId, enrollmentBId] } } })
    );
    expect(enrollmentRows.map((r) => r.id).sort()).toEqual([enrollmentAId, enrollmentBId].sort());
  });
});
