import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { AuthzActor, RoleName } from "@/lib/authz";
import { getStorageDriver } from "@/lib/storage";
import { createSession, markSessionSteppedUp } from "@/lib/sessions";

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
  opts: { roles?: RoleName[]; status?: "active" | "suspended" | "deleted" } = {}
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

/** Deletes any NotificationPreference rows for a set of test users (Session 39) — call before cleanupTestUsers() deletes the User rows notification_preferences.user_id references (ON DELETE NO ACTION, same convention as every other cleanup helper here). */
export async function cleanupTestNotificationPreferences(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
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

/**
 * Deletes a set of test-created articles, including their cover-image
 * asset attachments — call this BEFORE cleanupTestUsers() for any users
 * referenced as author/moderator (keen_africans_articles migration's FKs
 * are all ON DELETE NO ACTION, same convention as every other cleanup
 * helper here).
 */
/**
 * Deletes a set of test-created Comment rows, including any Report rows
 * filed against them (polymorphic entityId, no FK — same convention
 * cleanupTestArticles' own Report cleanup uses) — call this before
 * cleanupTestArticles()/cleanupTestUsers() for any users referenced as
 * comment author/deleter (keen_africans_comments migration's FKs are all
 * ON DELETE NO ACTION, same convention as every other cleanup helper
 * here).
 */
export async function cleanupTestComments(commentIds: string[]): Promise<void> {
  if (commentIds.length === 0) return;
  await prisma.report.deleteMany({ where: { entityType: "comment", entityId: { in: commentIds } } });
  await prisma.comment.deleteMany({ where: { id: { in: commentIds } } });
}

/** Deletes any Comment rows (and their reports) on a set of test-created articles — call BEFORE those Article rows are deleted, since comments.article_id has no FK cascade. */
async function cleanupCommentsByArticleIds(articleIds: string[]): Promise<void> {
  if (articleIds.length === 0) return;
  const commentIds = (
    await prisma.comment.findMany({ where: { articleId: { in: articleIds } }, select: { id: true } })
  ).map((c) => c.id);
  await cleanupTestComments(commentIds);
}

/** Deletes any ArticleReaction rows for a set of test users — call before cleanupTestUsers() deletes the User rows (keen_africans_article_reactions migration's FK is ON DELETE NO ACTION, same convention as every other cleanup helper here). */
export async function cleanupTestReactions(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.articleReaction.deleteMany({ where: { userId: { in: userIds } } });
}

export async function cleanupTestArticles(articleIds: string[]): Promise<void> {
  if (articleIds.length === 0) return;
  const coverAssetIds = (
    await prisma.article.findMany({ where: { id: { in: articleIds } }, select: { coverAssetId: true } })
  )
    .map((a) => a.coverAssetId)
    .filter((id): id is string => id !== null);
  await prisma.assetAttachment.deleteMany({ where: { entityType: "article_cover", entityId: { in: articleIds } } });
  // Session 41 (Admin Moderation, Reporting & Verification Review) — Report
  // rows against an article have no FK (polymorphic entityId, see
  // schema.prisma's Report comment), so nothing else cleans these up.
  await prisma.report.deleteMany({ where: { entityType: "article", entityId: { in: articleIds } } });
  // Session 43 (Comments & Reactions) — comments/reactions on a test
  // article have no FK cascade either, so clean them up before the
  // article row itself.
  await cleanupCommentsByArticleIds(articleIds);
  await prisma.articleReaction.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
  await cleanupTestAssets(coverAssetIds);
}

/**
 * Deletes a set of test-created Profile rows, including their avatar asset
 * attachments — call this BEFORE cleanupTestUsers() for any users
 * referenced as profile owners (keen_africans_profiles_core migration's
 * FK is ON DELETE NO ACTION, same convention as every other cleanup helper
 * here). Takes user ids, not profile ids, since Profile.userId is what
 * every test fixture actually has on hand (mirrors cleanupTestArticles'
 * article-id shape one level up — this is the userId-keyed equivalent).
 */
export async function cleanupTestProfiles(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const profiles = await prisma.profile.findMany({ where: { userId: { in: userIds } }, select: { id: true, avatarAssetId: true } });
  const profileIds = profiles.map((p) => p.id);
  const avatarAssetIds = profiles.map((p) => p.avatarAssetId).filter((id): id is string => id !== null);
  await prisma.assetAttachment.deleteMany({ where: { entityType: "avatar", entityId: { in: profileIds } } });
  await prisma.profile.deleteMany({ where: { id: { in: profileIds } } });
  await cleanupTestAssets(avatarAssetIds);
}

/**
 * Deletes any Report rows filed by or reviewed by a set of test users —
 * call this before cleanupTestUsers() deletes the User rows (keen_africans_
 * reports migration's FKs are all ON DELETE NO ACTION, same convention as
 * every other cleanup helper here). Takes user ids since that's what every
 * test fixture has on hand; a report against a test-created article/profile
 * is also covered since cleanupTestArticles/cleanupTestProfiles don't
 * themselves clean "reports" rows (entityId is polymorphic, no FK) — call
 * this with every relevant user id (reporter, reviewer, AND the reported
 * user for a profile report) to catch those too.
 */
export async function cleanupTestReports(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: userIds } }, { reviewedBy: { in: userIds } }, { entityId: { in: userIds } }] },
  });
}

/**
 * Deletes any Follow rows where a set of test users are either the
 * follower or the followed account — call this before cleanupTestUsers()
 * deletes the User rows (keen_africans_follows migration's FKs are all ON
 * DELETE NO ACTION, same convention as every other cleanup helper here).
 */
export async function cleanupTestFollows(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.follow.deleteMany({
    where: { OR: [{ followerId: { in: userIds } }, { followingId: { in: userIds } }] },
  });
}

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await cleanupTestFollows(userIds);
  // Session 43 (Comments & Reactions) — must run before cleanupTestReports
  // below only in the sense that both must precede the User deletes; a
  // comment's own Report rows are cleaned as part of cleanupTestComments
  // itself (entityId there is a commentId, not a userId, so
  // cleanupTestReports(userIds) alone would never catch them).
  await cleanupTestReactions(userIds);
  const authoredOrDeletedCommentIds = (
    await prisma.comment.findMany({
      where: { OR: [{ authorId: { in: userIds } }, { deletedBy: { in: userIds } }] },
      select: { id: true },
    })
  ).map((c) => c.id);
  await cleanupTestComments(authoredOrDeletedCommentIds);
  await cleanupTestReports(userIds);
  await cleanupTestNotifications(userIds);
  await cleanupTestNotificationPreferences(userIds);
  await cleanupTestConversations(userIds);
  await cleanupTestCertificates(userIds);
  const authoredArticleIds = (
    await prisma.article.findMany({ where: { authorId: { in: userIds } }, select: { id: true } })
  ).map((a) => a.id);
  await cleanupTestArticles(authoredArticleIds);
  await cleanupTestProfiles(userIds);
  await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
  const uploadedAssetIds = (
    await prisma.asset.findMany({ where: { uploaderId: { in: userIds } }, select: { id: true } })
  ).map((a) => a.id);
  await cleanupTestAssets(uploadedAssetIds);
  await prisma.lessonProgress.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.studentNote.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.bookmark.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.recoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.totpCredential.deleteMany({ where: { userId: { in: userIds } } });
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

/**
 * MFA & Account Security (Session 20) — an actor with a REAL, already
 * stepped-up Session row, for tests exercising a function gated by
 * src/lib/mfa.ts's requireStepUp() (assignRole() for SUPER_ADMIN/ADMIN,
 * changeMemberRole() granting org_admin, changeOwnPassword/
 * changeOwnEmail, disableMfa, regenerateRecoveryCodes, ...). Plain
 * actorFromUser()/orgActorFromUser() carry no sessionId at all, which
 * requireStepUp() correctly treats as "not stepped up" — this is the
 * fixture for the positive case; call requireStepUp() against a
 * sessionId-less actor directly to test the negative case.
 */
export async function steppedUpActorFromUser(
  userId: string,
  opts: { org?: boolean } = {}
): Promise<AuthzActor> {
  const actor = opts.org ? await orgActorFromUser(userId) : await actorFromUser(userId);
  const session = await createSession({ userId });
  await markSessionSteppedUp(session.id, userId);
  return { ...actor, sessionId: session.id };
}
