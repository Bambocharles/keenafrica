import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent, getCourseById, listMyCourses } from "@/lib/courses";
import { createLesson, createModule, getCourseContentForStudent } from "@/lib/content";
import { actorFromUser, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Session 05 (Teacher) application-layer coverage: "teacher sees only
 * authorized courses/cohorts" and "students cannot retrieve unpublished
 * material through the API" — the two acceptance criteria this session's
 * build brief calls out by name. The RLS-level proof for the same
 * boundaries (which the app-layer functions here rely on as a second,
 * independent enforcement layer — see docs/EDUCATION_CORE.md) lives in
 * teacher-cohort-rls.integration.test.ts.
 */
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

describe("listMyCourses — a teacher's own course list", () => {
  it("returns an empty list for a teacher assigned to nothing yet, rather than throwing", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const teacherActor = await actorFromUser(teacher.id);
    await expect(listMyCourses(teacherActor)).resolves.toEqual([]);
  });

  it("returns only the courses a teacher is actually assigned to, never a stranger's course", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    const myCourse = await createCourse({ title: `Mine ${Date.now()}` }, adminActor);
    createdCourseIds.push(myCourse.id);
    const myCohort = await createCohort(myCourse.id, { name: "A" }, adminActor);

    const otherCourse = await createCourse({ title: `Not mine ${Date.now()}` }, adminActor);
    createdCourseIds.push(otherCourse.id);

    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(myCohort.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);

    const mine = await listMyCourses(teacherActor);
    expect(mine.map((c) => c.id)).toEqual([myCourse.id]);
    expect(mine.map((c) => c.id)).not.toContain(otherCourse.id);
  });

  it("a STUDENT (no content permission at all) cannot call this — the negative authorization case", async () => {
    const student = await user({ roles: ["STUDENT"] });
    const studentActor = await actorFromUser(student.id);
    await expect(listMyCourses(studentActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("getCourseById — a teacher cannot read a course they are not assigned to", () => {
  it("rejects an outsider teacher outright, even one holding courses.content.write generally", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: `Locked ${Date.now()}` }, adminActor);
    createdCourseIds.push(course.id);
    await createCohort(course.id, { name: "A" }, adminActor);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(getCourseById(course.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("getCourseContentForStudent — draft material stays unreachable via the API", () => {
  it("an enrolled student cannot fetch a module/lesson the teacher has not published", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: `Draft-guarded ${Date.now()}` }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "A" }, adminActor);

    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);

    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    await createLesson(module.id, { title: "Still drafting", content: "not ready" }, teacherActor);
    // Deliberately never published.

    const student = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await actorFromUser(student.id);

    const view = await getCourseContentForStudent(course.id, studentActor);
    expect(view!.modules).toHaveLength(0);
  });
});
