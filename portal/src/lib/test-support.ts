import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthzActor, RoleName } from "@/lib/authz";
import { getStorageDriver } from "@/lib/storage";

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

/**
 * Deletes any Asset rows a set of test users uploaded, including the
 * AssetAttachment rows referencing them and the underlying storage bytes —
 * call this before cleanupTestUsers()/cleanupTestCourses() delete the
 * Resource/User rows those attachments and uploads reference (assets_files
 * migration's FKs are all ON DELETE NO ACTION, same convention as every
 * other cleanup helper here).
 */
export async function cleanupTestAssets(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, storageKey: true } });
  await prisma.assetAttachment.deleteMany({ where: { assetId: { in: assetIds } } });
  await prisma.asset.deleteMany({ where: { id: { in: assetIds } } });
  const driver = getStorageDriver();
  await Promise.all(assets.map((a) => driver.delete(a.storageKey).catch(() => {})));
}

/** Shared by cleanupTestConversations/cleanupTestCourses — deletes a known set of conversation ids and everything hanging off them. */
async function deleteConversationsByIds(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;

  const messages = await prisma.message.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } });
  const messageIds = messages.map((m) => m.id);
  const messageAssetIds = (
    await prisma.assetAttachment.findMany({
      where: { entityType: "message", entityId: { in: messageIds } },
      select: { assetId: true },
    })
  ).map((a) => a.assetId);
  await prisma.assetAttachment.deleteMany({ where: { entityType: "message", entityId: { in: messageIds } } });
  await cleanupTestAssets(messageAssetIds);
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
}

/**
 * Deletes any Conversation rows a set of test users participate in
 * (including messages, message attachments, and participant rows) — call
 * this before cleanupTestUsers() deletes the User rows those reference
 * (messaging_core migration's FKs are all ON DELETE NO ACTION, same
 * convention as every other cleanup helper here).
 */
export async function cleanupTestConversations(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const conversationIds = (
    await prisma.conversationParticipant.findMany({ where: { userId: { in: userIds } }, select: { conversationId: true } })
  ).map((p) => p.conversationId);
  await deleteConversationsByIds(conversationIds);
}

/** Deletes any Notification rows addressed to a set of test users — call before cleanupTestUsers() deletes the User rows notifications.recipient_id references (ON DELETE NO ACTION, same convention as every other cleanup helper here). */
export async function cleanupTestNotifications(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
}

/**
 * Deletes any Certificate rows for a set of student user ids, including
 * their downloadable-file asset attachments — call this before
 * cleanupTestUsers()/cleanupTestCourses() delete the User/Course/Enrollment
 * rows certificates.ts's FKs reference (certificates_core migration's FKs
 * are all ON DELETE NO ACTION, same convention as every other cleanup
 * helper here).
 */
export async function cleanupTestCertificates(studentUserIds: string[]): Promise<void> {
  if (studentUserIds.length === 0) return;
  const certificates = await prisma.certificate.findMany({
    where: { studentUserId: { in: studentUserIds } },
    select: { id: true },
  });
  const certificateIds = certificates.map((c) => c.id);
  const certAssetIds = (
    await prisma.assetAttachment.findMany({
      where: { entityType: "certificate", entityId: { in: certificateIds } },
      select: { assetId: true },
    })
  ).map((a) => a.assetId);
  await prisma.assetAttachment.deleteMany({ where: { entityType: "certificate", entityId: { in: certificateIds } } });
  await prisma.certificate.deleteMany({ where: { id: { in: certificateIds } } });
  await cleanupTestAssets(certAssetIds);
}

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await cleanupTestNotifications(userIds);
  await cleanupTestConversations(userIds);
  await cleanupTestCertificates(userIds);
  const uploadedAssetIds = (
    await prisma.asset.findMany({ where: { uploaderId: { in: userIds } }, select: { id: true } })
  ).map((a) => a.id);
  await cleanupTestAssets(uploadedAssetIds);
  await prisma.lessonProgress.deleteMany({ where: { studentUserId: { in: userIds } } });
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
  // Progress (Session 08) — deepest child, no dependents of its own.
  await prisma.lessonProgress.deleteMany({ where: { courseId: { in: courseIds } } });
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
  // Session 13 — asset-backed resources: capture ids before the resource
  // rows (and their asset_attachments) are gone, then purge the assets
  // themselves (metadata row + storage bytes) once nothing references them.
  const courseResources = await prisma.resource.findMany({
    where: { lesson: { courseId: { in: courseIds } } },
    select: { id: true, assetId: true },
  });
  const courseAssetIds = courseResources.map((r) => r.assetId).filter((id): id is string => id !== null);
  await prisma.assetAttachment.deleteMany({
    where: { entityType: "lesson_resource", entityId: { in: courseResources.map((r) => r.id) } },
  });
  await prisma.resource.deleteMany({ where: { lesson: { courseId: { in: courseIds } } } });
  await cleanupTestAssets(courseAssetIds);
  await prisma.lessonVersion.deleteMany({ where: { lesson: { courseId: { in: courseIds } } } });
  await prisma.lesson.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.module.deleteMany({ where: { courseId: { in: courseIds } } });
  // Session 09 — cohort_broadcast conversations reference a cohort via
  // context_cohort_id; must go before the cohorts themselves are deleted.
  const broadcastConversationIds = (
    await prisma.conversation.findMany({
      where: { contextCohort: { courseId: { in: courseIds } } },
      select: { id: true },
    })
  ).map((c) => c.id);
  await deleteConversationsByIds(broadcastConversationIds);
  // Session 14 — certificates.enrollment_id/course_id FKs must go before
  // the enrollments/courses themselves.
  const courseCertificates = await prisma.certificate.findMany({
    where: { courseId: { in: courseIds } },
    select: { id: true },
  });
  const courseCertificateIds = courseCertificates.map((c) => c.id);
  const certAssetIds = (
    await prisma.assetAttachment.findMany({
      where: { entityType: "certificate", entityId: { in: courseCertificateIds } },
      select: { assetId: true },
    })
  ).map((a) => a.assetId);
  await prisma.assetAttachment.deleteMany({ where: { entityType: "certificate", entityId: { in: courseCertificateIds } } });
  await prisma.certificate.deleteMany({ where: { id: { in: courseCertificateIds } } });
  await cleanupTestAssets(certAssetIds);
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

/**
 * Deletes a set of test-created projects and everything hanging off them
 * (memberships, milestones, metrics, documents + their assets), in
 * dependency order — call this BEFORE cleanupTestSponsors()/
 * cleanupTestUsers() for any sponsor/user referenced (Session 11's
 * sponsor_core migration's FKs are all ON DELETE NO ACTION, same
 * convention as cleanupTestCourses above).
 */
export async function cleanupTestProjects(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  const documents = await prisma.projectDocument.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, assetId: true } });
  await prisma.assetAttachment.deleteMany({ where: { entityType: "sponsor_document", entityId: { in: documents.map((d) => d.id) } } });
  await prisma.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } });
  await cleanupTestAssets(documents.map((d) => d.assetId));
  await prisma.milestone.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectMetric.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectMembership.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
}

/** Call after cleanupTestProjects() — sponsors are referenced by projects.projectId's FK. */
export async function cleanupTestSponsors(sponsorIds: string[]): Promise<void> {
  if (sponsorIds.length === 0) return;
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: sponsorIds } } });
  await prisma.sponsor.deleteMany({ where: { id: { in: sponsorIds } } });
}

/**
 * Deletes a set of test-created organizations and everything hanging off
 * them (memberships, invitations) — call this BEFORE cleanupTestUsers()
 * for any users referenced as creator/member/inviter (organization_core
 * migration's FKs are all ON DELETE NO ACTION, same convention as every
 * other cleanup helper here).
 */
export async function cleanupTestOrganizations(organizationIds: string[]): Promise<void> {
  if (organizationIds.length === 0) return;
  await prisma.organizationInvitation.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
}

/** The same {id, isSuperAdmin, permissions} shape as actorFromUser(), plus organizationIds — for src/lib/organizations.test.ts, which needs the org-scoped RLS session var populated. */
export async function orgActorFromUser(userId: string) {
  const actor = await actorFromUser(userId);
  const memberships = await prisma.organizationMembership.findMany({ where: { userId, status: "active" }, select: { organizationId: true } });
  return { ...actor, organizationIds: memberships.map((m) => m.organizationId) };
}
