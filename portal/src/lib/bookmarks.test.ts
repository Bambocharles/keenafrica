import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent, publishCourse } from "@/lib/courses";
import { createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import { addBookmark, listMyBookmarks, removeBookmark } from "@/lib/bookmarks";
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

async function setup() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Bookmarks Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
  await publishCourse(course.id, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  const student = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, student.id, adminActor);
  const studentActor = await actorFromUser(student.id);

  const module = await createModule(course.id, { title: "Module 1" }, teacherActor);
  await publishModule(module.id, teacherActor);
  const publishedLesson = await createLesson(module.id, { title: "Lesson 1", content: "body" }, teacherActor);
  await publishLesson(publishedLesson.id, teacherActor);
  const draftLesson = await createLesson(module.id, { title: "Draft lesson", content: "secret" }, teacherActor);

  return { admin, adminActor, course, cohort, teacherActor, studentActor, publishedLesson, draftLesson };
}

describe("addBookmark — ownership, visibility, idempotency", () => {
  it("an enrolled student can bookmark a published lesson", async () => {
    const { course, publishedLesson, studentActor } = await setup();
    const bookmark = await addBookmark(
      { courseId: course.id, targetType: "lesson", targetId: publishedLesson.id },
      studentActor
    );
    expect(bookmark.studentUserId).toBe(studentActor.id);
    expect(bookmark.targetId).toBe(publishedLesson.id);
  });

  it("bookmarking the same lesson twice is idempotent, not a duplicate/error", async () => {
    const { course, publishedLesson, studentActor } = await setup();
    await addBookmark({ courseId: course.id, targetType: "lesson", targetId: publishedLesson.id }, studentActor);
    await addBookmark({ courseId: course.id, targetType: "lesson", targetId: publishedLesson.id }, studentActor);

    const bookmarks = await listMyBookmarks({ courseId: course.id }, studentActor);
    expect(bookmarks).toHaveLength(1);
  });

  it("rejects bookmarking a still-draft lesson", async () => {
    const { course, draftLesson, studentActor } = await setup();
    await expect(
      addBookmark({ courseId: course.id, targetType: "lesson", targetId: draftLesson.id }, studentActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects a bookmark from a student never enrolled in the course", async () => {
    const { course, publishedLesson } = await setup();
    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(
      addBookmark({ courseId: course.id, targetType: "lesson", targetId: publishedLesson.id }, outsiderActor)
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("removeBookmark / listMyBookmarks — self-only", () => {
  it("the owner can remove their own bookmark", async () => {
    const { course, publishedLesson, studentActor } = await setup();
    const bookmark = await addBookmark(
      { courseId: course.id, targetType: "lesson", targetId: publishedLesson.id },
      studentActor
    );

    await removeBookmark(bookmark.id, studentActor);
    const remaining = await listMyBookmarks({ courseId: course.id }, studentActor);
    expect(remaining).toHaveLength(0);
  });

  it("a different student cannot see or remove another student's bookmark", async () => {
    const { admin, adminActor, course, cohort, publishedLesson, studentActor } = await setup();
    void admin;
    const bookmark = await addBookmark(
      { courseId: course.id, targetType: "lesson", targetId: publishedLesson.id },
      studentActor
    );

    const otherStudent = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, otherStudent.id, adminActor);
    const otherActor = await actorFromUser(otherStudent.id);

    const otherBookmarks = await listMyBookmarks({ courseId: course.id }, otherActor);
    expect(otherBookmarks).toHaveLength(0);

    await expect(removeBookmark(bookmark.id, otherActor)).rejects.toThrow("Bookmark not found");
  });
});
