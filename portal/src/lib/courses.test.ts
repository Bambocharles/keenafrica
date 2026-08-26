import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  archiveCourse,
  assignTeacherToCohort,
  createCohort,
  createCourse,
  enrollStudent,
  getCourseById,
  isCourseTeacher,
  listCourses,
  listCohortsForCourse,
  listMyCourses,
  listMyEnrollments,
  publishCourse,
  removeTeacherFromCohort,
  updateCourseDetails,
  withdrawEnrollment,
} from "@/lib/courses";
import { actorFromUser, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

describe("createCourse — authorization boundary", () => {
  it("requires courses.create", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(createCourse({ title: "Blocked" }, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("an admin can create a course, in draft status, and it is audited", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    const course = await createCourse({ title: "Intro to Farming", description: "Basics" }, adminActor);
    createdCourseIds.push(course.id);

    expect(course.status).toBe("draft");
    expect(course.createdBy).toBe(admin.id);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "course.created", entityId: course.id } });
    expect(audit).not.toBeNull();
  });
});

describe("publishCourse / archiveCourse — authorization boundary + CoursePublished event", () => {
  it("requires courses.publish, not just courses.manage", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Needs Publish" }, adminActor);
    createdCourseIds.push(course.id);

    // A holder of courses.content.write only (e.g. TEACHER) cannot publish a course.
    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);
    await expect(publishCourse(course.id, teacherActor)).rejects.toThrow(AuthorizationError);
  });

  it("publishing sets status=published, publishedAt, and audits", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "To Publish" }, adminActor);
    createdCourseIds.push(course.id);

    await publishCourse(course.id, adminActor);

    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(row.status).toBe("published");
    expect(row.publishedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findFirst({ where: { action: "course.published", entityId: course.id } });
    expect(audit).not.toBeNull();
  });

  it("archiving sets status=archived", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "To Archive" }, adminActor);
    createdCourseIds.push(course.id);

    await archiveCourse(course.id, adminActor);

    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(row.status).toBe("archived");
  });
});

describe("updateCourseDetails — authorization boundary", () => {
  it("requires courses.manage", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Original" }, adminActor);
    createdCourseIds.push(course.id);

    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);
    await expect(updateCourseDetails(course.id, { title: "Hijacked" }, teacherActor)).rejects.toThrow(
      AuthorizationError
    );

    await updateCourseDetails(course.id, { title: "Updated" }, adminActor);
    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(row.title).toBe("Updated");
  });
});

describe("Cohort + CohortTeacher — ownership boundary", () => {
  it("createCohort/assignTeacherToCohort require courses.manage", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Cohort Course" }, adminActor);
    createdCourseIds.push(course.id);

    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);
    await expect(createCohort(course.id, { name: "Cohort A" }, teacherActor)).rejects.toThrow(AuthorizationError);
  });

  it("assignTeacherToCohort rejects a target user who doesn't hold the TEACHER role", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Role Check Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

    const notATeacher = await user({ roles: ["STUDENT"] });
    await expect(assignTeacherToCohort(cohort.id, notATeacher.id, adminActor)).rejects.toThrow(/TEACHER/);
  });

  it("assigning a teacher makes isCourseTeacher true, and removing it makes it false again", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Ownership Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);

    expect(await isCourseTeacher(course.id, teacherActor)).toBe(false);

    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    expect(await isCourseTeacher(course.id, teacherActor)).toBe(true);

    await removeTeacherFromCohort(cohort.id, teacher.id, adminActor);
    expect(await isCourseTeacher(course.id, teacherActor)).toBe(false);
  });

  it("a teacher assigned to a cohort can read the course; an unassigned teacher cannot", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Read Boundary Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

    const assignedTeacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohort.id, assignedTeacher.id, adminActor);
    const assignedActor = await actorFromUser(assignedTeacher.id);

    const unassignedTeacher = await user({ roles: ["TEACHER"] });
    const unassignedActor = await actorFromUser(unassignedTeacher.id);

    await expect(getCourseById(course.id, assignedActor)).resolves.not.toBeNull();
    await expect(getCourseById(course.id, unassignedActor)).rejects.toThrow(AuthorizationError);
  });

  it("listMyCourses returns only courses the teacher is assigned to via cohort_teachers", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const courseA = await createCourse({ title: "Course A" }, adminActor);
    const courseB = await createCourse({ title: "Course B" }, adminActor);
    createdCourseIds.push(courseA.id, courseB.id);
    const cohortA = await createCohort(courseA.id, { name: "Cohort A" }, adminActor);

    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohortA.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);

    const mine = await listMyCourses(teacherActor);
    expect(mine.map((c) => c.id)).toEqual([courseA.id]);
  });

  it("listCohortsForCourse requires courses.manage, super_admin, or being a teacher on the course", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Cohort List Course" }, adminActor);
    createdCourseIds.push(course.id);
    await createCohort(course.id, { name: "Cohort A" }, adminActor);

    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);
    await expect(listCohortsForCourse(course.id, strangerActor)).rejects.toThrow(AuthorizationError);

    const cohorts = await listCohortsForCourse(course.id, adminActor);
    expect(cohorts).toHaveLength(1);
  });
});

describe("Enrollment — authorization boundary + idempotency + StudentEnrolled event", () => {
  it("enrollStudent requires courses.manage", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Enroll Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
    const student = await user({ roles: ["STUDENT"] });

    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);
    await expect(enrollStudent(cohort.id, student.id, teacherActor)).rejects.toThrow(AuthorizationError);
  });

  it("enrollStudent rejects a target user who doesn't hold the STUDENT role", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Role Check Enroll Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
    const notAStudent = await user({ roles: ["TEACHER"] });

    await expect(enrollStudent(cohort.id, notAStudent.id, adminActor)).rejects.toThrow(/STUDENT/);
  });

  it("enrolling the same student twice is idempotent, and shows up in listMyEnrollments", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Idempotent Enroll Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
    const student = await user({ roles: ["STUDENT"] });

    const first = await enrollStudent(cohort.id, student.id, adminActor);
    const second = await enrollStudent(cohort.id, student.id, adminActor);
    expect(second.id).toBe(first.id);

    const count = await prisma.enrollment.count({ where: { cohortId: cohort.id, studentUserId: student.id } });
    expect(count).toBe(1);

    const studentActor = await actorFromUser(student.id);
    const mine = await listMyEnrollments(studentActor);
    expect(mine.map((e) => e.id)).toContain(first.id);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "student.enrolled", entityId: first.id } });
    expect(audit).not.toBeNull();
  });

  it("withdrawEnrollment sets status=withdrawn, and re-enrolling reactivates it", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Withdraw Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
    const student = await user({ roles: ["STUDENT"] });

    const enrollment = await enrollStudent(cohort.id, student.id, adminActor);
    await withdrawEnrollment(enrollment.id, adminActor);

    let row = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(row.status).toBe("withdrawn");

    const reactivated = await enrollStudent(cohort.id, student.id, adminActor);
    expect(reactivated.id).toBe(enrollment.id);
    row = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(row.status).toBe("active");
  });
});

describe("listCourses — admin directory", () => {
  it("requires courses.manage", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);
    await expect(listCourses({}, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("an admin can list and filter courses by status", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const draftCourse = await createCourse({ title: "Draft Listing Course" }, adminActor);
    const publishedCourse = await createCourse({ title: "Published Listing Course" }, adminActor);
    createdCourseIds.push(draftCourse.id, publishedCourse.id);
    await publishCourse(publishedCourse.id, adminActor);

    const published = await listCourses({ status: "published" }, adminActor);
    expect(published.courses.map((c) => c.id)).toContain(publishedCourse.id);
    expect(published.courses.map((c) => c.id)).not.toContain(draftCourse.id);
  });
});
