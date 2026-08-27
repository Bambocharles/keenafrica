import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import {
  assignTeacherToCohort,
  createCohort,
  createCourse,
  enrollStudent,
  publishCourse,
} from "@/lib/courses";
import { suspendUser } from "@/lib/users";
import { createQuestion } from "@/lib/questions";
import { addQuestionToAssessment, assignAssessmentToCohort, createAssessment, publishAssessment } from "@/lib/assessments";
import { startAttempt, submitAttempt } from "@/lib/attempts";
import { startConversation } from "@/lib/messaging";
import { FEATURE_FLAGS, _resetFeatureFlagCache } from "@/lib/feature-flags";
import * as mailer from "@/lib/mailer";
import {
  createNotification,
  getUnreadNotificationCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
} from "@/lib/notifications";
import { actorFromUser, cleanupTestCourses, cleanupTestNotifications, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const ORIGINAL_OVERRIDES = process.env.FEATURE_FLAG_OVERRIDES;

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterEach(() => {
  process.env.FEATURE_FLAG_OVERRIDES = ORIGINAL_OVERRIDES;
  _resetFeatureFlagCache();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupTestNotifications(createdUserIds);
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

/** Course + one cohort, one assigned teacher, one enrolled student — the minimal shared fixture. */
async function setupCourseWithStudent() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Notif Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacherUser = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacherUser.id, adminActor);
  const teacherActor = await actorFromUser(teacherUser.id);

  const studentUser = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, studentUser.id, adminActor);
  const studentActor = await actorFromUser(studentUser.id);
  // enrollStudent() emits StudentEnrolled fire-and-forget (see events.ts —
  // emitDomainEvent never awaits its async listeners), so the resulting
  // notification row may not exist yet the instant this function returns.
  // Every test below either waits again itself after its own action, or
  // (like this one) needs the fixture to have already settled.
  await new Promise((r) => setTimeout(r, 20));

  return { admin, adminActor, course, cohort, teacherUser, teacherActor, studentUser, studentActor };
}

/** Full assigned-assessment fixture, reusing Session 07's own test setup shape (attempts.test.ts). */
async function setupAssignedAssessment() {
  const { course, cohort, teacherActor, studentUser, studentActor } = await setupCourseWithStudent();

  const assessment = await createAssessment(course.id, { title: "Notif Quiz" }, teacherActor);
  const q = await createQuestion(
    course.id,
    { type: "single_choice", prompt: "2+2?", options: [{ text: "3", isCorrect: false }, { text: "4", isCorrect: true }] },
    teacherActor
  );
  await addQuestionToAssessment(assessment.id, q.id, { points: 2 }, teacherActor);
  await publishAssessment(assessment.id, teacherActor);
  await assignAssessmentToCohort(assessment.id, cohort.id, {}, teacherActor);

  return { course, cohort, teacherActor, studentUser, studentActor, assessment, q };
}

// --- Core write path: createNotification ----------------------------------

describe("createNotification — duplicate delivery protection", () => {
  it("the same (recipientId, dedupeKey) occurrence is delivered at most once", async () => {
    const recipient = await user();
    const dedupeKey = `test:${Date.now()}-${Math.random()}`;

    const first = await createNotification({
      recipientId: recipient.id,
      type: "message_received",
      title: "Hello",
      body: "World",
      dedupeKey,
    });
    const second = await createNotification({
      recipientId: recipient.id,
      type: "message_received",
      title: "Hello again — should be suppressed",
      body: "World",
      dedupeKey,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const recipientActor = await actorFromUser(recipient.id);
    const { total, notifications } = await listMyNotifications(recipientActor);
    expect(total).toBe(1);
    // The second (duplicate) call's title never overwrote the first.
    expect(notifications[0].title).toBe("Hello");
  });

  it("a different dedupeKey for the same recipient/type creates a second, independent notification", async () => {
    const recipient = await user();
    await createNotification({ recipientId: recipient.id, type: "message_received", title: "First", body: "b", dedupeKey: `a:${Date.now()}` });
    await createNotification({ recipientId: recipient.id, type: "message_received", title: "Second", body: "b", dedupeKey: `b:${Date.now()}` });

    const recipientActor = await actorFromUser(recipient.id);
    const { total } = await listMyNotifications(recipientActor);
    expect(total).toBe(2);
  });
});

describe("createNotification — email channel is flag-gated", () => {
  it("never calls sendMail while notifications_email is off (the default)", async () => {
    const sendMailSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    process.env.FEATURE_FLAG_OVERRIDES = JSON.stringify({ [FEATURE_FLAGS.NOTIFICATIONS_EMAIL]: false });
    _resetFeatureFlagCache();

    const recipient = await user();
    await createNotification({ recipientId: recipient.id, type: "message_received", title: "t", body: "b", dedupeKey: `off:${Date.now()}` });

    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it("calls sendMail exactly once per real (non-duplicate) notification while notifications_email is on", async () => {
    const sendMailSpy = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    process.env.FEATURE_FLAG_OVERRIDES = JSON.stringify({ [FEATURE_FLAGS.NOTIFICATIONS_EMAIL]: true });
    _resetFeatureFlagCache();

    const recipient = await user();
    const dedupeKey = `on:${Date.now()}`;
    await createNotification({ recipientId: recipient.id, type: "message_received", title: "t", body: "b", dedupeKey });
    // A duplicate delivery of the SAME occurrence must not re-send email.
    await createNotification({ recipientId: recipient.id, type: "message_received", title: "t", body: "b", dedupeKey });

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    expect(sendMailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: recipient.email }));
  });

  it("a channel failure never prevents the in-app notification from existing", async () => {
    vi.spyOn(mailer, "sendMail").mockRejectedValue(new Error("smtp down"));
    process.env.FEATURE_FLAG_OVERRIDES = JSON.stringify({ [FEATURE_FLAGS.NOTIFICATIONS_EMAIL]: true });
    _resetFeatureFlagCache();

    const recipient = await user();
    const result = await createNotification({ recipientId: recipient.id, type: "message_received", title: "t", body: "b", dedupeKey: `fail:${Date.now()}` });
    expect(result.created).toBe(true);

    const recipientActor = await actorFromUser(recipient.id);
    const { total } = await listMyNotifications(recipientActor);
    expect(total).toBe(1);
  });
});

// --- Recipient authorization -----------------------------------------------

describe("recipient authorization — Must NOT expose another user's notifications", () => {
  it("listMyNotifications never returns another user's notifications", async () => {
    const a = await user();
    const b = await user();
    await createNotification({ recipientId: a.id, type: "message_received", title: "for a", body: "b", dedupeKey: `a-only:${Date.now()}` });

    const bActor = await actorFromUser(b.id);
    const { total, notifications } = await listMyNotifications(bActor);
    expect(total).toBe(0);
    expect(notifications).toHaveLength(0);
  });

  it("a stranger cannot mark another user's notification read", async () => {
    const owner = await user();
    const stranger = await user();
    await createNotification({ recipientId: owner.id, type: "message_received", title: "t", body: "b", dedupeKey: `owned:${Date.now()}` });
    const ownerActor = await actorFromUser(owner.id);
    const { notifications } = await listMyNotifications(ownerActor);
    const notificationId = notifications[0].id;

    const strangerActor = await actorFromUser(stranger.id);
    await expect(markNotificationRead(notificationId, strangerActor)).rejects.toThrow(AuthorizationError);

    // Confirm it's genuinely still unread — the rejected attempt made no change.
    const { notifications: stillUnread } = await listMyNotifications(ownerActor);
    expect(stillUnread[0].readAt).toBeNull();
  });

  it("the recipient can mark their own notification read, and getUnreadNotificationCount reflects it", async () => {
    const owner = await user();
    await createNotification({ recipientId: owner.id, type: "message_received", title: "t1", body: "b", dedupeKey: `read1:${Date.now()}` });
    await createNotification({ recipientId: owner.id, type: "message_received", title: "t2", body: "b", dedupeKey: `read2:${Date.now()}` });
    const ownerActor = await actorFromUser(owner.id);

    expect(await getUnreadNotificationCount(ownerActor)).toBe(2);

    const { notifications } = await listMyNotifications(ownerActor);
    await markNotificationRead(notifications[0].id, ownerActor);

    expect(await getUnreadNotificationCount(ownerActor)).toBe(1);
  });

  it("markAllNotificationsRead only touches the caller's own rows", async () => {
    const a = await user();
    const b = await user();
    await createNotification({ recipientId: a.id, type: "message_received", title: "t", body: "b", dedupeKey: `all-a:${Date.now()}` });
    await createNotification({ recipientId: b.id, type: "message_received", title: "t", body: "b", dedupeKey: `all-b:${Date.now()}` });

    const aActor = await actorFromUser(a.id);
    await markAllNotificationsRead(aActor);

    expect(await getUnreadNotificationCount(aActor)).toBe(0);
    const bActor = await actorFromUser(b.id);
    expect(await getUnreadNotificationCount(bActor)).toBe(1);
  });
});

// --- Event-to-notification mapping (real events, not synthetic payloads) --

describe("MessageReceived -> message_received", () => {
  it("notifies the recipient, not the sender, and links to the conversation", async () => {
    const { teacherUser, teacherActor, studentUser } = await setupCourseWithStudent();

    const { conversation } = await startConversation(
      { type: "direct", participantIds: [studentUser.id], body: "Welcome to the course!" },
      teacherActor
    );
    await new Promise((r) => setTimeout(r, 20));

    // The student already has one student_enrolled notification from
    // setupCourseWithStudent()'s own enrollment — this message adds a
    // second, independent one.
    const studentActor = await actorFromUser(studentUser.id);
    const { notifications: studentNotifs } = await listMyNotifications(studentActor);
    const messageNotif = studentNotifs.find((n) => n.type === "message_received");
    expect(messageNotif).toBeDefined();
    expect(messageNotif!.title).toContain(teacherUser.name);
    expect(messageNotif!.entityType).toBe("conversation");
    expect(messageNotif!.entityId).toBe(conversation.id);
    expect(notificationHref(messageNotif!)).toBe(`/messages/${conversation.id}`);

    // The sender never gets a notification for their own message.
    const teacherOwnActor = await actorFromUser(teacherUser.id);
    const { notifications: teacherNotifs } = await listMyNotifications(teacherOwnActor);
    expect(teacherNotifs.some((n) => n.type === "message_received")).toBe(false);
  });
});

describe("StudentEnrolled -> student_enrolled", () => {
  it("notifies the enrolled student, and re-enrolling an already-active student does not duplicate it", async () => {
    const { course, cohort, adminActor, studentUser } = await setupCourseWithStudent();

    const studentActor = await actorFromUser(studentUser.id);
    const { total: afterFirst } = await listMyNotifications(studentActor);
    expect(afterFirst).toBe(1);

    // enrollStudent's own idempotent "already active" branch still re-emits
    // StudentEnrolled with the same enrolledAt — this is the exact
    // real-world duplicate-delivery scenario the dedupeKey design targets.
    await enrollStudent(cohort.id, studentUser.id, adminActor);
    await new Promise((r) => setTimeout(r, 20));

    const { total: afterSecond, notifications } = await listMyNotifications(studentActor);
    expect(afterSecond).toBe(1);
    expect(notifications[0].type).toBe("student_enrolled");
    expect(notificationHref(notifications[0])).toBe(`/courses/${course.id}`);
  });
});

describe("CoursePublished -> course_published", () => {
  it("notifies actively enrolled students of that course", async () => {
    const { course, studentUser, adminActor } = await setupCourseWithStudent();

    await publishCourse(course.id, adminActor);
    await new Promise((r) => setTimeout(r, 20));

    const studentActor = await actorFromUser(studentUser.id);
    const { notifications } = await listMyNotifications(studentActor);
    expect(notifications.some((n) => n.type === "course_published")).toBe(true);
  });
});

describe("UserSuspended -> account_suspended", () => {
  it("notifies the suspended user", async () => {
    const target = await user({ roles: ["STUDENT"] });
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    await suspendUser(target.id, adminActor);
    await new Promise((r) => setTimeout(r, 20));

    const targetActor = await actorFromUser(target.id);
    const { notifications } = await listMyNotifications(targetActor);
    expect(notifications.some((n) => n.type === "account_suspended")).toBe(true);
  });
});

describe("AssessmentSubmitted -> assessment_submitted (teacher)", () => {
  it("notifies the course's teacher, not the submitting student", async () => {
    const { teacherActor, studentActor, assessment } = await setupAssignedAssessment();

    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(attempt.id, [], studentActor);
    await new Promise((r) => setTimeout(r, 20));

    const { notifications: teacherNotifs } = await listMyNotifications(teacherActor);
    const submitted = teacherNotifs.find((n) => n.type === "assessment_submitted");
    expect(submitted).toBeDefined();
    expect(submitted!.entityType).toBe("attempt");
    expect(submitted!.entityId).toBe(attempt.id);

    const { notifications: studentNotifs } = await listMyNotifications(studentActor);
    expect(studentNotifs.some((n) => n.type === "assessment_submitted")).toBe(false);
  });
});

describe("AssessmentGraded -> assessment_graded (student)", () => {
  it("notifies the student once the attempt is fully graded, with a link to their result", async () => {
    const { studentActor, assessment, q } = await setupAssignedAssessment();

    const correctOption = q.options.find((o) => o.isCorrect)!;
    const attempt = await startAttempt(assessment.id, studentActor);
    await submitAttempt(attempt.id, [{ questionId: q.id, selectedOptionIds: [correctOption.id] }], studentActor);
    await new Promise((r) => setTimeout(r, 20));

    const { notifications } = await listMyNotifications(studentActor);
    const graded = notifications.find((n) => n.type === "assessment_graded");
    expect(graded).toBeDefined();
    expect(graded!.entityType).toBe("attempt");
    expect(graded!.entityId).toBe(attempt.id);
    expect(notificationHref(graded!)).toBe(`/results/${attempt.id}`);
  });
});
