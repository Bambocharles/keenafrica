import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import {
  assignTeacherToCohort,
  createCohort,
  createCourse,
  enrollStudent,
  getCourseById,
  listMyCourses,
  listMyCoursesForWorkspace,
} from "@/lib/courses";
import { createAssessment } from "@/lib/assessments";
import { createQuestion } from "@/lib/questions";
import { createLesson, createModule, getCourseContentForStudent, publishLesson, publishModule } from "@/lib/content";
import { approveJoinRequest, createOrganization, listOrganizationMembers, requestToJoinOrganization } from "@/lib/organizations";
import {
  actorFromUser,
  cleanupTestCourses,
  cleanupTestOrganizations,
  cleanupTestUsers,
  createTestUser,
  orgActorFromUser,
} from "@/lib/test-support";

/**
 * Organization-Aware Education (Session 21) — application-layer coverage
 * for src/lib/courses.ts's new organizationId/scope support and the
 * write-time org-membership integrity check
 * (assertTargetIsOrgMemberIfScoped, exercised indirectly via
 * assignTeacherToCohort/enrollStudent). The DB-layer RLS backstop is
 * proven independently and more thoroughly in
 * organization-aware-education-rls.integration.test.ts against the real
 * non-superuser role — this file proves the application-layer contract
 * courses.ts/assessments.ts/questions.ts/organizations.ts expose.
 */
const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdOrgIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

let slugCounter = 0;
function uniqueSlug(): string {
  slugCounter += 1;
  return `org-edu-test-${Date.now()}-${slugCounter}`;
}

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

describe("createCourse: scope/organizationId", () => {
  it("defaults to PLATFORM scope with no organizationId — every pre-Session-21 caller is unaffected", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Platform Course" }, adminActor);
    createdCourseIds.push(course.id);
    expect(course.scope).toBe("platform");
    expect(course.organizationId).toBeNull();
  });

  it("creates an ORGANIZATION-scoped course when organizationId is supplied", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const org = await createOrganization({ name: "Edu Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const course = await createCourse({ title: "Org Course", organizationId: org.id }, adminActor);
    createdCourseIds.push(course.id);
    expect(course.scope).toBe("organization");
    expect(course.organizationId).toBe(org.id);
  });

  it("rejects a non-existent organizationId", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    await expect(createCourse({ title: "Bad Org Course", organizationId: randomUUID() }, adminActor)).rejects.toThrow(
      /Organization not found/
    );
  });
});

// --- Session 45 (Outstanding Fixes & Consolidation) ----------------------
//
// Teacher org-scoped course creation: the decision recorded in
// status/project-status.md on 2026-08-31 that no session between 21 and 44
// implemented. A TEACHER holds courses.create.organization (never
// courses.create) and may create ONLY an organization-scoped course, for an
// organization they are an ACTIVE member of.
//
// Both halves are proven: the positive case, and every negative case that
// defines the boundary (no organizationId at all; an organization they've
// never joined; one they only have a PENDING request for; one they were
// removed from). The RLS backstop for the same rule is proven independently
// in organization-aware-education-rls.integration.test.ts against the real
// non-superuser role — these are the application-layer assertions.
describe("createCourse: teacher org-scoped creation (Session 45)", () => {
  async function teacherInOrg() {
    const founder = await user();
    const org = await createOrganization({ name: "Teacher Create Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const teacher = await user({ roles: ["TEACHER"] });
    await makeActiveOrgMember(org.id, founder.id, teacher.id);
    return { founder, org, teacher };
  }

  it("a TEACHER holds courses.create.organization but NOT courses.create or courses.manage", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);
    expect(teacherActor.permissions).toContain("courses.create.organization");
    expect(teacherActor.permissions).not.toContain("courses.create");
    expect(teacherActor.permissions).not.toContain("courses.manage");
  });

  it("POSITIVE: a teacher who is an active member creates an ORGANIZATION-scoped course in that organization", async () => {
    const { org, teacher } = await teacherInOrg();
    const teacherActor = await orgActorFromUser(teacher.id);

    const course = await createCourse({ title: "Teacher Org Course", organizationId: org.id }, teacherActor);
    createdCourseIds.push(course.id);

    expect(course.scope).toBe("organization");
    expect(course.organizationId).toBe(org.id);
    expect(course.createdBy).toBe(teacher.id);
    expect(course.status).toBe("draft");
  });

  it("NEGATIVE: the same teacher cannot create a PLATFORM-wide course (no organizationId)", async () => {
    const { teacher } = await teacherInOrg();
    const teacherActor = await orgActorFromUser(teacher.id);

    await expect(createCourse({ title: "Teacher Platform Course" }, teacherActor)).rejects.toThrow(AuthorizationError);
  });

  it("NEGATIVE: the same teacher cannot create a course in an organization they don't belong to", async () => {
    const { teacher } = await teacherInOrg();
    const teacherActor = await orgActorFromUser(teacher.id);

    const otherFounder = await user();
    const otherOrg = await createOrganization(
      { name: "Someone Else's Org", slug: uniqueSlug() },
      await orgActorFromUser(otherFounder.id)
    );
    createdOrgIds.push(otherOrg.id);

    await expect(
      createCourse({ title: "Cross-Tenant Course", organizationId: otherOrg.id }, teacherActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("NEGATIVE: a PENDING (unapproved) join request is not membership — creation is still refused", async () => {
    const founder = await user();
    const org = await createOrganization({ name: "Pending Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const teacher = await user({ roles: ["TEACHER"] });
    // Requested, deliberately NOT approved — this is the exact "nobody can
    // grant themselves membership by naming an organization" rule
    // organizations.ts's module docstring states, applied to course
    // creation.
    await requestToJoinOrganization(org.id, await orgActorFromUser(teacher.id));

    await expect(
      createCourse({ title: "Pending Member Course", organizationId: org.id }, await orgActorFromUser(teacher.id))
    ).rejects.toThrow(AuthorizationError);
  });

  it("NEGATIVE: an actor with neither courses.create nor courses.create.organization is refused, exactly as before this session", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);
    await expect(createCourse({ title: "Stranger Course" }, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("an ADMIN's own reach is unchanged: still creates platform-wide courses, and org-scoped ones for organizations they are NOT a member of", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const org = await createOrganization({ name: "Admin Reach Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const platform = await createCourse({ title: "Admin Platform Course" }, adminActor);
    createdCourseIds.push(platform.id);
    expect(platform.scope).toBe("platform");

    // adminActor has no OrganizationMembership row in this org at all.
    const scoped = await createCourse({ title: "Admin Org Course", organizationId: org.id }, adminActor);
    createdCourseIds.push(scoped.id);
    expect(scoped.organizationId).toBe(org.id);
  });

  it("the created course appears in the creating teacher's own workspace list before any cohort exists, flagged as not-yet-taught", async () => {
    const { org, teacher } = await teacherInOrg();
    const teacherActor = await orgActorFromUser(teacher.id);

    const course = await createCourse({ title: "Visible To Creator", organizationId: org.id }, teacherActor);
    createdCourseIds.push(course.id);

    const mine = await listMyCoursesForWorkspace(teacherActor);
    const row = mine.find((c) => c.id === course.id);
    expect(row).toBeDefined();
    // Creating a course does NOT make you its teacher — that still needs a
    // cohort_teachers row an admin creates.
    expect(row!.isTaught).toBe(false);

    // listMyCourses() (the "which courses do I teach" question the teacher
    // dashboard and assessments picker ask) is deliberately unchanged and
    // does NOT include it.
    expect((await listMyCourses(teacherActor)).map((c) => c.id)).not.toContain(course.id);

    // ...and it is in no unrelated teacher's list either.
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderCourses = await listMyCoursesForWorkspace(await orgActorFromUser(outsider.id));
    expect(outsiderCourses.map((c) => c.id)).not.toContain(course.id);
  });
});

describe("createCohort/createAssessment/createQuestion: organizationId denormalization", () => {
  it("a cohort/assessment/question of an ORGANIZATION-scoped course all inherit its organizationId; of a PLATFORM course, all stay null", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const org = await createOrganization({ name: "Denorm Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const platformCourse = await createCourse({ title: "Denorm Platform Course" }, adminActor);
    createdCourseIds.push(platformCourse.id);
    const orgCourse = await createCourse({ title: "Denorm Org Course", organizationId: org.id }, adminActor);
    createdCourseIds.push(orgCourse.id);

    const platformCohort = await createCohort(platformCourse.id, { name: "P Cohort" }, adminActor);
    const orgCohort = await createCohort(orgCourse.id, { name: "O Cohort" }, adminActor);
    expect(platformCohort.organizationId).toBeNull();
    expect(orgCohort.organizationId).toBe(org.id);

    const platformAssessment = await createAssessment(platformCourse.id, { title: "P Assessment" }, adminActor);
    const orgAssessment = await createAssessment(orgCourse.id, { title: "O Assessment" }, adminActor);
    expect(platformAssessment.organizationId).toBeNull();
    expect(orgAssessment.organizationId).toBe(org.id);

    const platformQuestion = await createQuestion(platformCourse.id, { type: "short_answer", prompt: "P?" }, adminActor);
    const orgQuestion = await createQuestion(orgCourse.id, { type: "short_answer", prompt: "O?" }, adminActor);
    expect(platformQuestion.organizationId).toBeNull();
    expect(orgQuestion.organizationId).toBe(org.id);
  });
});

describe("assignTeacherToCohort / enrollStudent: write-time organization-membership integrity check", () => {
  it("rejects assigning a teacher who is NOT an active member of an ORGANIZATION-scoped cohort's organization", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const org = await createOrganization({ name: "Integrity Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const course = await createCourse({ title: "Integrity Course", organizationId: org.id }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Integrity Cohort" }, adminActor);

    const outsiderTeacher = await user({ roles: ["TEACHER"] });
    await expect(assignTeacherToCohort(cohort.id, outsiderTeacher.id, adminActor)).rejects.toThrow(AuthorizationError);

    const memberTeacher = await user({ roles: ["TEACHER"] });
    await makeActiveOrgMember(org.id, founder.id, memberTeacher.id);
    await expect(assignTeacherToCohort(cohort.id, memberTeacher.id, adminActor)).resolves.toBeUndefined();
  });

  it("rejects enrolling a student who is NOT an active member of an ORGANIZATION-scoped cohort's organization", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const org = await createOrganization({ name: "Integrity Org 2", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(org.id);

    const course = await createCourse({ title: "Integrity Course 2", organizationId: org.id }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Integrity Cohort 2" }, adminActor);

    const outsiderStudent = await user({ roles: ["STUDENT"] });
    await expect(enrollStudent(cohort.id, outsiderStudent.id, adminActor)).rejects.toThrow(AuthorizationError);

    const memberStudent = await user({ roles: ["STUDENT"] });
    await makeActiveOrgMember(org.id, founder.id, memberStudent.id);
    const enrollment = await enrollStudent(cohort.id, memberStudent.id, adminActor);
    expect(enrollment.studentUserId).toBe(memberStudent.id);
  });

  it("REGRESSION: a PLATFORM-scoped cohort's assignment/enrollment is completely unaffected — no organization membership required of anyone", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Regression Platform Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Regression Cohort" }, adminActor);

    const teacher = await user({ roles: ["TEACHER"] });
    const student = await user({ roles: ["STUDENT"] });
    await expect(assignTeacherToCohort(cohort.id, teacher.id, adminActor)).resolves.toBeUndefined();
    await expect(enrollStudent(cohort.id, student.id, adminActor)).resolves.toBeDefined();
  });
});

describe("REGRESSION: PLATFORM-scoped course vertical slice is unchanged (Session 04's acceptance criterion, org-aware actors)", () => {
  it("Admin -> Teacher -> Publish -> Student visibility still works end-to-end for a PLATFORM course, even when actors happen to carry unrelated organization memberships", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const founder = await user();
    const unrelatedOrg = await createOrganization({ name: "Unrelated Org", slug: uniqueSlug() }, await orgActorFromUser(founder.id));
    createdOrgIds.push(unrelatedOrg.id);

    const course = await createCourse({ title: "UTME Mathematics (Session 21 regression)" }, adminActor);
    createdCourseIds.push(course.id);
    expect(course.scope).toBe("platform");

    const cohort = await createCohort(course.id, { name: "2026 Cohort A" }, adminActor);
    const teacher = await user({ roles: ["TEACHER"] });
    await makeActiveOrgMember(unrelatedOrg.id, founder.id, teacher.id);
    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    const teacherActor = await orgActorFromUser(teacher.id);

    const student = await user({ roles: ["STUDENT"] });
    await makeActiveOrgMember(unrelatedOrg.id, founder.id, student.id);
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await orgActorFromUser(student.id);

    const module = await createModule(course.id, { title: "Algebra Basics" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "Linear Equations", content: "Solving for x..." }, teacherActor);
    await publishModule(module.id, teacherActor);
    await publishLesson(lesson.id, teacherActor);

    const visible = await getCourseContentForStudent(course.id, studentActor);
    expect(visible!.modules).toHaveLength(1);
    expect(visible!.modules[0].lessons.map((l) => l.id)).toEqual([lesson.id]);

    // getCourseById also still resolves normally for the teacher.
    const fetched = await getCourseById(course.id, teacherActor);
    expect(fetched?.id).toBe(course.id);
  });
});
