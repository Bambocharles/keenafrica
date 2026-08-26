import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent, publishCourse } from "@/lib/courses";
import { createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import { createNote, deleteNote, listMyNotes, updateNote } from "@/lib/notes";
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

/** Course + cohort + assigned teacher + enrolled student + one published lesson, one still-draft lesson. */
async function setup() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Notes Course ${Date.now()}-${Math.random()}` }, adminActor);
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

  return { course, cohort, teacherActor, studentActor, publishedLesson, draftLesson };
}

describe("createNote — ownership and visibility boundaries", () => {
  it("an enrolled student can create a course-level note", async () => {
    const { course, studentActor } = await setup();
    const note = await createNote(
      { courseId: course.id, targetType: "course", targetId: course.id, body: "Great course!" },
      studentActor
    );
    expect(note.studentUserId).toBe(studentActor.id);
    expect(note.body).toBe("Great course!");
  });

  it("an enrolled student can create a note on a published lesson", async () => {
    const { course, publishedLesson, studentActor } = await setup();
    const note = await createNote(
      { courseId: course.id, targetType: "lesson", targetId: publishedLesson.id, body: "Remember this" },
      studentActor
    );
    expect(note.targetId).toBe(publishedLesson.id);
  });

  it("rejects a note on a still-draft lesson, even for an enrolled student", async () => {
    const { course, draftLesson, studentActor } = await setup();
    await expect(
      createNote({ courseId: course.id, targetType: "lesson", targetId: draftLesson.id, body: "Sneaky" }, studentActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects any note from a student never enrolled in the course", async () => {
    const { course, publishedLesson } = await setup();
    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(
      createNote({ courseId: course.id, targetType: "course", targetId: course.id, body: "x" }, outsiderActor)
    ).rejects.toThrow(AuthorizationError);
    await expect(
      createNote({ courseId: course.id, targetType: "lesson", targetId: publishedLesson.id, body: "x" }, outsiderActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("rejects a note whose targetId doesn't belong to the given course", async () => {
    const { studentActor } = await setup();
    const other = await setup();

    await expect(
      createNote(
        { courseId: other.course.id, targetType: "lesson", targetId: other.publishedLesson.id, body: "x" },
        studentActor
      )
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("updateNote / deleteNote — self-only, privacy from other students and the course teacher", () => {
  it("the owning student can update and delete their own note", async () => {
    const { course, studentActor } = await setup();
    const note = await createNote(
      { courseId: course.id, targetType: "course", targetId: course.id, body: "v1" },
      studentActor
    );

    const updated = await updateNote(note.id, "v2", studentActor);
    expect(updated.body).toBe("v2");

    await deleteNote(note.id, studentActor);
    const remaining = await listMyNotes({ courseId: course.id }, studentActor);
    expect(remaining.find((n) => n.id === note.id)).toBeUndefined();
  });

  it("a different student cannot read, update, or delete another student's note", async () => {
    const { course, cohort, studentActor } = await setup();
    const note = await createNote(
      { courseId: course.id, targetType: "course", targetId: course.id, body: "private" },
      studentActor
    );

    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const otherStudent = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, otherStudent.id, adminActor);
    const otherActor = await actorFromUser(otherStudent.id);

    const otherNotes = await listMyNotes({ courseId: course.id }, otherActor);
    expect(otherNotes.find((n) => n.id === note.id)).toBeUndefined();

    await expect(updateNote(note.id, "tampered", otherActor)).rejects.toThrow("Note not found");
    await expect(deleteNote(note.id, otherActor)).rejects.toThrow("Note not found");
  });

  it("the course's own teacher cannot see a student's notes — notes are private, not course content", async () => {
    const { course, teacherActor, studentActor } = await setup();
    await createNote({ courseId: course.id, targetType: "course", targetId: course.id, body: "private" }, studentActor);

    const teacherNotes = await listMyNotes({ courseId: course.id }, teacherActor);
    expect(teacherNotes).toHaveLength(0);
  });
});
