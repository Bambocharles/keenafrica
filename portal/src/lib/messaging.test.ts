import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { onDomainEvent, type DomainEventMap } from "@/lib/events";
import {
  assertCanMessage,
  getConversationThread,
  listMessageableForStudent,
  listMessageableStudentsForTeacher,
  listMyBroadcastCohorts,
  listMyConversations,
  markConversationRead,
  sendMessage,
  startConversation,
} from "@/lib/messaging";
import { approveJoinRequest, createOrganization, listOrganizationMembers, requestToJoinOrganization } from "@/lib/organizations";
import {
  actorFromUser,
  cleanupTestCourses,
  cleanupTestOrganizations,
  cleanupTestUsers,
  createTestUser,
  orgActorFromUser,
} from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdOrgIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

let orgSlugCounter = 0;
function uniqueOrgSlug(): string {
  orgSlugCounter += 1;
  return `msg-org-test-${Date.now()}-${orgSlugCounter}`;
}

/** Session 21 — approves userId into orgId, ending in an ACTIVE org_member row. */
async function makeActiveOrgMember(orgId: string, founderId: string, userId: string) {
  await requestToJoinOrganization(orgId, await orgActorFromUser(userId));
  const pending = await listOrganizationMembers(orgId, await orgActorFromUser(founderId));
  const row = pending.find((m) => m.userId === userId)!;
  await approveJoinRequest(row.membershipId, await orgActorFromUser(founderId));
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestOrganizations(createdOrgIds);
  await cleanupTestUsers(createdUserIds);
});

/** Course + one cohort, one assigned teacher, two enrolled students. */
async function setup() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Messaging Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacherUser = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacherUser.id, adminActor);
  const teacherActor = await actorFromUser(teacherUser.id);

  const s1User = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, s1User.id, adminActor);
  const s1Actor = await actorFromUser(s1User.id);

  const s2User = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, s2User.id, adminActor);
  const s2Actor = await actorFromUser(s2User.id);

  return { admin, adminActor, course, cohort, teacherUser, teacherActor, s1User, s1Actor, s2User, s2Actor };
}

function captureMessageReceived(): { events: DomainEventMap["MessageReceived"][]; stop: () => void } {
  const events: DomainEventMap["MessageReceived"][] = [];
  const stop = onDomainEvent("MessageReceived", (payload) => {
    events.push(payload);
  });
  return { events, stop };
}

describe("assertCanMessage — relationship gating", () => {
  it("allows a teacher to message their own enrolled student", async () => {
    const { teacherActor, s1User } = await setup();
    await expect(assertCanMessage(teacherActor, s1User.id)).resolves.toBeUndefined();
  });

  it("allows a student to message their own cohort's teacher", async () => {
    const { s1Actor, teacherUser } = await setup();
    await expect(assertCanMessage(s1Actor, teacherUser.id)).resolves.toBeUndefined();
  });

  it("allows a student to message a fellow cohort-mate", async () => {
    const { s1Actor, s2User } = await setup();
    await expect(assertCanMessage(s1Actor, s2User.id)).resolves.toBeUndefined();
  });

  it("rejects a teacher messaging a student they don't teach", async () => {
    const { teacherActor } = await setup();
    const outsider = await user({ roles: ["STUDENT"] });
    await expect(assertCanMessage(teacherActor, outsider.id)).rejects.toThrow(AuthorizationError);
  });

  it("rejects a student messaging a teacher who doesn't teach any of their cohorts", async () => {
    const { s1Actor } = await setup();
    const outsiderTeacher = await user({ roles: ["TEACHER"] });
    await expect(assertCanMessage(s1Actor, outsiderTeacher.id)).rejects.toThrow(AuthorizationError);
  });

  it("rejects a student messaging an unrelated student (no shared cohort)", async () => {
    const { s1Actor } = await setup();
    const outsiderStudent = await user({ roles: ["STUDENT"] });
    await expect(assertCanMessage(s1Actor, outsiderStudent.id)).rejects.toThrow(AuthorizationError);
  });

  it("rejects messaging yourself", async () => {
    const { s1Actor, s1User } = await setup();
    await expect(assertCanMessage(s1Actor, s1User.id)).rejects.toThrow(AuthorizationError);
  });

  it("allows an admin (messages.admin) to message any user, bypassing the relationship check", async () => {
    const { adminActor } = await setup();
    const unrelatedStudent = await user({ roles: ["STUDENT"] });
    await expect(assertCanMessage(adminActor, unrelatedStudent.id)).resolves.toBeUndefined();
  });

  it("rejects a STUDENT role holder with no cohort at all (no relationship, but does hold messages.send)", async () => {
    const lonelyStudent = await user({ roles: ["STUDENT"] });
    const lonelyActor = await actorFromUser(lonelyStudent.id);
    const { teacherUser } = await setup();
    await expect(assertCanMessage(lonelyActor, teacherUser.id)).rejects.toThrow(AuthorizationError);
  });
});

describe("startConversation — direct/group/cohort_broadcast", () => {
  it("creates a direct conversation and its first message between a teacher and their student", async () => {
    const { teacherActor, s1User } = await setup();
    const capture = captureMessageReceived();
    try {
      const { conversation, message } = await startConversation(
        { type: "direct", participantIds: [s1User.id], body: "Welcome to the course!" },
        teacherActor
      );
      expect(conversation.type).toBe("direct");
      expect(message.body).toBe("Welcome to the course!");
      expect(capture.events).toEqual([{ messageId: message.id, conversationId: conversation.id, recipientId: s1User.id }]);
    } finally {
      capture.stop();
    }
  });

  it("rejects a direct conversation with a recipient outside any permitted relationship", async () => {
    const { teacherActor } = await setup();
    const outsider = await user({ roles: ["STUDENT"] });
    await expect(
      startConversation({ type: "direct", participantIds: [outsider.id], body: "hi" }, teacherActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("creates a group conversation to several selected students", async () => {
    const { teacherActor, s1User, s2User } = await setup();
    const { conversation } = await startConversation(
      { type: "group", participantIds: [s1User.id, s2User.id], body: "Group announcement" },
      teacherActor
    );
    const thread = await getConversationThread(conversation.id, teacherActor);
    expect(thread.conversation.participants.map((p) => p.userId).sort()).toEqual(
      [teacherActor.id, s1User.id, s2User.id].sort()
    );
  });

  it("cohort_broadcast fans out to every actively-enrolled student in that cohort", async () => {
    const { teacherActor, cohort, s1User, s2User } = await setup();
    const capture = captureMessageReceived();
    try {
      const { conversation, message } = await startConversation(
        { type: "cohort_broadcast", cohortId: cohort.id, body: "Class announcement" },
        teacherActor
      );
      expect(conversation.contextCohortId).toBe(cohort.id);
      const recipientIds = capture.events.filter((e) => e.messageId === message.id).map((e) => e.recipientId);
      expect(recipientIds.sort()).toEqual([s1User.id, s2User.id].sort());
    } finally {
      capture.stop();
    }
  });

  it("rejects a cohort_broadcast from a teacher not assigned to that cohort", async () => {
    const { cohort } = await setup();
    const outsiderTeacher = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsiderTeacher.id);
    await expect(
      startConversation({ type: "cohort_broadcast", cohortId: cohort.id, body: "Sneaky broadcast" }, outsiderActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects an empty body with no attachment", async () => {
    const { teacherActor, s1User } = await setup();
    await expect(
      startConversation({ type: "direct", participantIds: [s1User.id], body: "   " }, teacherActor)
    ).rejects.toThrow();
  });
});

describe("sendMessage — participant-only, existing conversation", () => {
  it("a participant can post a follow-up message", async () => {
    const { teacherActor, s1Actor, s1User } = await setup();
    const { conversation } = await startConversation(
      { type: "direct", participantIds: [s1User.id], body: "first" },
      teacherActor
    );
    const reply = await sendMessage(conversation.id, { body: "reply from student" }, s1Actor);
    expect(reply.senderId).toBe(s1Actor.id);
  });

  it("rejects a non-participant trying to post into a conversation they're not part of", async () => {
    const { teacherActor, s1User, s2Actor } = await setup();
    const { conversation } = await startConversation(
      { type: "direct", participantIds: [s1User.id], body: "first" },
      teacherActor
    );
    await expect(sendMessage(conversation.id, { body: "eavesdropping" }, s2Actor)).rejects.toThrow(AuthorizationError);
  });

  it("emits MessageReceived for every OTHER participant, never the sender themselves", async () => {
    const { teacherActor, s1Actor, s1User } = await setup();
    const { conversation } = await startConversation(
      { type: "direct", participantIds: [s1User.id], body: "first" },
      teacherActor
    );
    const capture = captureMessageReceived();
    try {
      const reply = await sendMessage(conversation.id, { body: "reply" }, s1Actor);
      expect(capture.events).toEqual([{ messageId: reply.id, conversationId: conversation.id, recipientId: teacherActor.id }]);
    } finally {
      capture.stop();
    }
  });
});

describe("read/unread state", () => {
  it("a fresh recipient has an unread count of 1 after the first message, 0 after marking read", async () => {
    const { teacherActor, s1Actor, s1User } = await setup();
    await startConversation({ type: "direct", participantIds: [s1User.id], body: "hello" }, teacherActor);

    const before = await listMyConversations(s1Actor);
    expect(before[0].unreadCount).toBe(1);

    await markConversationRead(before[0].id, s1Actor);

    const after = await listMyConversations(s1Actor);
    expect(after[0].unreadCount).toBe(0);
  });

  it("the sender's own unread count for their own conversation is always 0", async () => {
    const { teacherActor, s1User } = await setup();
    await startConversation({ type: "direct", participantIds: [s1User.id], body: "hello" }, teacherActor);

    const mine = await listMyConversations(teacherActor);
    expect(mine[0].unreadCount).toBe(0);
  });

  it("markConversationRead rejects a non-participant", async () => {
    const { teacherActor, s1User, s2Actor } = await setup();
    const { conversation } = await startConversation({ type: "direct", participantIds: [s1User.id], body: "hi" }, teacherActor);
    await expect(markConversationRead(conversation.id, s2Actor)).rejects.toThrow(AuthorizationError);
  });
});

describe("eligible-recipient listings", () => {
  it("listMessageableStudentsForTeacher returns the teacher's own enrolled students, deduped", async () => {
    const { teacherActor, s1User, s2User } = await setup();
    const students = await listMessageableStudentsForTeacher(teacherActor);
    expect(students.map((s) => s.id).sort()).toEqual([s1User.id, s2User.id].sort());
  });

  it("listMyBroadcastCohorts returns cohorts the teacher is assigned to", async () => {
    const { teacherActor, cohort } = await setup();
    const cohorts = await listMyBroadcastCohorts(teacherActor);
    expect(cohorts.map((c) => c.cohortId)).toContain(cohort.id);
  });

  it("listMessageableForStudent returns the student's own teacher(s) and classmate(s)", async () => {
    const { s1Actor, teacherUser, s2User } = await setup();
    const { teachers, classmates } = await listMessageableForStudent(s1Actor);
    expect(teachers.map((t) => t.id)).toEqual([teacherUser.id]);
    expect(classmates.map((c) => c.id)).toEqual([s2User.id]);
  });
});

describe("Organization-Aware Education (Session 21) — cross-organization messaging guard", () => {
  /**
   * An ORGANIZATION-scoped course/cohort where the teacher and student
   * share the cohort but belong to DIFFERENT organizations. courses.ts's
   * assignTeacherToCohort()/enrollStudent() would themselves reject
   * creating such a mismatched pair (assertTargetIsOrgMemberIfScoped) — so
   * this fixture goes around them with a raw prisma write, exactly the
   * "bypassed/legacy row" scenario messaging.ts's own explicit check
   * (independent of that integrity check, and independent of RLS) exists
   * to still catch. See src/lib/organization-aware-education-rls.
   * integration.test.ts for the equivalent proof at the RLS layer.
   */
  async function setupCrossOrgMismatch() {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founderA = await user();
    const founderB = await user();
    const orgA = await createOrganization({ name: "Msg Org A", slug: uniqueOrgSlug() }, await orgActorFromUser(founderA.id));
    const orgB = await createOrganization({ name: "Msg Org B", slug: uniqueOrgSlug() }, await orgActorFromUser(founderB.id));
    createdOrgIds.push(orgA.id, orgB.id);

    const course = await createCourse({ title: `Cross-Org Course ${Date.now()}`, organizationId: orgA.id }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cross-Org Cohort" }, adminActor);

    const teacherUser = await user({ roles: ["TEACHER"] });
    await makeActiveOrgMember(orgA.id, founderA.id, teacherUser.id);
    await prisma.cohortTeacher.create({ data: { cohortId: cohort.id, teacherUserId: teacherUser.id } });
    const teacherActor = await orgActorFromUser(teacherUser.id);

    const studentUser = await user({ roles: ["STUDENT"] });
    await makeActiveOrgMember(orgB.id, founderB.id, studentUser.id);
    await prisma.enrollment.create({ data: { cohortId: cohort.id, studentUserId: studentUser.id, status: "active" } });
    const studentActor = await orgActorFromUser(studentUser.id);

    return { orgA, orgB, teacherUser, teacherActor, studentUser, studentActor };
  }

  it("assertCanMessage rejects a teacher (Org A) and student (Org B) who share a cohort row but no organization membership", async () => {
    const { teacherActor, studentUser, studentActor, teacherUser } = await setupCrossOrgMismatch();
    await expect(assertCanMessage(teacherActor, studentUser.id)).rejects.toThrow(AuthorizationError);
    await expect(assertCanMessage(studentActor, teacherUser.id)).rejects.toThrow(AuthorizationError);
  });

  it("startConversation rejects the same cross-organization pairing end to end", async () => {
    const { teacherActor, studentUser } = await setupCrossOrgMismatch();
    await expect(
      startConversation({ type: "direct", participantIds: [studentUser.id], body: "hi" }, teacherActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("assertCanMessage ALLOWS a teacher and student who share an organization-scoped cohort AND the same organization", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const org = await createOrganization({ name: "Msg Org Same", slug: uniqueOrgSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const course = await createCourse({ title: `Same-Org Course ${Date.now()}`, organizationId: org.id }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Same-Org Cohort" }, adminActor);

    const teacherUser = await user({ roles: ["TEACHER"] });
    await makeActiveOrgMember(org.id, founder.id, teacherUser.id);
    await assignTeacherToCohort(cohort.id, teacherUser.id, adminActor);
    const teacherActor = await orgActorFromUser(teacherUser.id);

    const studentUser = await user({ roles: ["STUDENT"] });
    await makeActiveOrgMember(org.id, founder.id, studentUser.id);
    await enrollStudent(cohort.id, studentUser.id, adminActor);
    const studentActor = await orgActorFromUser(studentUser.id);

    await expect(assertCanMessage(teacherActor, studentUser.id)).resolves.toBeUndefined();
  });

  it("REGRESSION: a PLATFORM-scoped cohort's messaging is unaffected even when both parties belong to DIFFERENT organizations elsewhere", async () => {
    const { teacherActor, s1User, s1Actor, teacherUser } = await setup();
    const founderA = await user();
    const founderB = await user();
    const orgA = await createOrganization({ name: "Unrelated Org A", slug: uniqueOrgSlug() }, await orgActorFromUser(founderA.id));
    const orgB = await createOrganization({ name: "Unrelated Org B", slug: uniqueOrgSlug() }, await orgActorFromUser(founderB.id));
    createdOrgIds.push(orgA.id, orgB.id);
    await makeActiveOrgMember(orgA.id, founderA.id, teacherUser.id);
    await makeActiveOrgMember(orgB.id, founderB.id, s1User.id);

    const teacherOrgActor = await orgActorFromUser(teacherUser.id);
    const studentOrgActor = await orgActorFromUser(s1User.id);
    await expect(assertCanMessage(teacherOrgActor, s1User.id)).resolves.toBeUndefined();
    await expect(assertCanMessage(studentOrgActor, teacherActor.id)).resolves.toBeUndefined();
  });
});
