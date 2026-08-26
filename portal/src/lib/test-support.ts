import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthzActor, RoleName } from "@/lib/authz";

/**
 * Shared fixtures for the integration test suites (sessions/users/password-
 * reset). Writes directly via the raw `prisma` singleton — in local dev
 * this is the Postgres superuser connection (bypasses RLS), which is fine
 * here: these suites test the application-layer authorization logic in
 * src/lib/*.ts, not the RLS backstop itself (see rls.integration.test.ts
 * for that, against a real non-superuser role).
 */

// Cost factor 4 (bcrypt's minimum) — these are throwaway test passwords,
// not real credentials; the default cost factor (12, see users.ts) would
// make every test file take noticeably longer for no security benefit here.
const TEST_BCRYPT_COST = 4;

export async function createTestUser(
  opts: { roles?: RoleName[]; status?: "active" | "suspended" } = {}
) {
  const passwordHash = await hash("Test1234!", TEST_BCRYPT_COST);
  const user = await prisma.user.create({
    data: {
      email: `test-${randomUUID()}@example.com`,
      name: "Test User",
      passwordHash,
      status: opts.status ?? "active",
    },
  });

  if (opts.roles?.length) {
    const roleRows = await prisma.role.findMany({ where: { name: { in: opts.roles } } });
    await prisma.userRole.createMany({
      data: roleRows.map((r) => ({ userId: user.id, roleId: r.id })),
    });
  }

  return user;
}

/** Resolves the same {id, isSuperAdmin, permissions} shape the jwt callback computes. */
export async function actorFromUser(userId: string): Promise<AuthzActor> {
  const [user, userRoles] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    }),
  ]);
  const permissions = Array.from(
    new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)))
  );
  return { id: user.id, isSuperAdmin: user.isSuperAdmin, permissions };
}

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.studentNote.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.bookmark.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] },
  });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/**
 * Deletes a set of test-created courses and everything hanging off them
 * (cohorts/enrollments/cohort_teachers, modules/lessons/resources/
 * lesson_versions/lesson_topics), in dependency order. Call this BEFORE
 * cleanupTestUsers() for any users referenced as course creators/teachers/
 * students/publishers — the education_core migration's foreign keys are
 * all ON DELETE NO ACTION, so a user row can't be deleted while a course
 * entity still references it.
 */
export async function cleanupTestCourses(courseIds: string[]): Promise<void> {
  if (courseIds.length === 0) return;
  // Assessment Core (Session 07) — deepest children first: answers/attempts
  // reference assessments (via assessment_id) which reference courses.
  await prisma.answer.deleteMany({ where: { attempt: { assessment: { courseId: { in: courseIds } } } } });
  await prisma.attempt.deleteMany({ where: { assessment: { courseId: { in: courseIds } } } });
  await prisma.assessmentAssignment.deleteMany({ where: { assessment: { courseId: { in: courseIds } } } });
  await prisma.assessmentVersion.deleteMany({ where: { assessment: { courseId: { in: courseIds } } } });
  await prisma.assessmentQuestion.deleteMany({ where: { assessment: { courseId: { in: courseIds } } } });
  await prisma.questionTopic.deleteMany({ where: { question: { courseId: { in: courseIds } } } });
  await prisma.questionOption.deleteMany({ where: { question: { courseId: { in: courseIds } } } });
  await prisma.question.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.assessment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.studentNote.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.bookmark.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.lessonTopic.deleteMany({ where: { lesson: { courseId: { in: courseIds } } } });
  await prisma.resource.deleteMany({ where: { lesson: { courseId: { in: courseIds } } } });
  await prisma.lessonVersion.deleteMany({ where: { lesson: { courseId: { in: courseIds } } } });
  await prisma.lesson.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.module.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.enrollment.deleteMany({ where: { cohort: { courseId: { in: courseIds } } } });
  await prisma.cohortTeacher.deleteMany({ where: { cohort: { courseId: { in: courseIds } } } });
  await prisma.cohort.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
}

export async function cleanupTestTopics(topicIds: string[]): Promise<void> {
  if (topicIds.length === 0) return;
  await prisma.lessonTopic.deleteMany({ where: { topicId: { in: topicIds } } });
  await prisma.topic.deleteMany({ where: { id: { in: topicIds } } });
}
