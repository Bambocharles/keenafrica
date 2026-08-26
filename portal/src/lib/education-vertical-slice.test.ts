import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import {
  assignTeacherToCohort,
  createCohort,
  createCourse,
  enrollStudent,
  getCourseById,
  publishCourse,
} from "@/lib/courses";
import { createLesson, createModule, getCourseContentForStudent, publishLesson, publishModule } from "@/lib/content";
import { actorFromUser, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * The explicit acceptance-criteria vertical slice from
 * sessions/04-education-core.md: "Admin -> Teacher -> Publish -> Student
 * visibility." Every step uses ONLY the public src/lib/{courses,content}.ts
 * API — nothing here reaches into Prisma directly except for the final
 * negative assertions — proving the whole flow works through the real
 * authorization boundaries end to end, not just that the DB rows end up
 * correct.
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

describe("Vertical slice: Admin -> Teacher -> Publish -> Student visibility", () => {
  it("walks the full flow and enforces draft invisibility at every step", async () => {
    // 1. Admin creates a course (draft).
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "UTME Mathematics", description: "Foundational course" }, adminActor);
    createdCourseIds.push(course.id);
    expect(course.status).toBe("draft");

    // 2. Admin creates a cohort and assigns a teacher to it.
    const cohort = await createCohort(course.id, { name: "2026 Cohort A" }, adminActor);
    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);

    // 3. Admin enrolls a student into the cohort — before any content exists yet.
    const student = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await actorFromUser(student.id);

    // 4. Admin publishes the course itself (course-level lifecycle).
    await publishCourse(course.id, adminActor);

    // 5. Teacher (via cohort assignment, not courses.manage) authors a module + two lessons — draft by default.
    const module = await createModule(course.id, { title: "Algebra Basics" }, teacherActor);
    const lessonToPublish = await createLesson(
      module.id,
      { title: "Linear Equations", content: "Solving for x..." },
      teacherActor
    );
    const lessonKeptDraft = await createLesson(
      module.id,
      { title: "Quadratic Equations (unfinished)", content: "TODO" },
      teacherActor
    );

    // Not yet published: the student must see nothing yet, even though
    // they're enrolled and the course itself is published.
    const beforePublish = await getCourseContentForStudent(course.id, studentActor);
    expect(beforePublish!.modules).toHaveLength(0);

    // 6. Teacher publishes the module and ONE of the two lessons.
    await publishModule(module.id, teacherActor);
    await publishLesson(lessonToPublish.id, teacherActor);

    // 7. Student visibility: only the published lesson appears; the draft
    // lesson stays invisible — enforced server-side (app layer here; the
    // RLS integration suite proves the same at the DB layer independently).
    const afterPublish = await getCourseContentForStudent(course.id, studentActor);
    expect(afterPublish!.modules).toHaveLength(1);
    const visibleLessonIds = afterPublish!.modules[0].lessons.map((l) => l.id);
    expect(visibleLessonIds).toEqual([lessonToPublish.id]);
    expect(visibleLessonIds).not.toContain(lessonKeptDraft.id);

    // 8. Negative case: a DIFFERENT student, never enrolled, is rejected outright.
    const outsiderStudent = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsiderStudent.id);
    await expect(getCourseContentForStudent(course.id, outsiderActor)).rejects.toThrow(AuthorizationError);

    // 9. Negative case: a teacher never assigned to this course cannot even read it.
    const outsiderTeacher = await user({ roles: ["TEACHER"] });
    const outsiderTeacherActor = await actorFromUser(outsiderTeacher.id);
    await expect(getCourseById(course.id, outsiderTeacherActor)).rejects.toThrow(AuthorizationError);
  });
});
