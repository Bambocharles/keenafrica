import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import {
  assignTeacherToCohort,
  createCohort,
  createCourse,
  enrollStudent,
  getCourseById,
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
