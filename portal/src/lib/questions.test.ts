import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse } from "@/lib/courses";
import { createTopic } from "@/lib/topics";
import {
  archiveQuestion,
  createQuestion,
  getQuestionById,
  listQuestionBank,
  tagQuestion,
  unarchiveQuestion,
  untagQuestion,
  updateQuestion,
} from "@/lib/questions";
import { actorFromUser, cleanupTestCourses, cleanupTestTopics, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdTopicIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestTopics(createdTopicIds);
  await cleanupTestUsers(createdUserIds);
});

async function setupCourseWithTeacher() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  return { admin, adminActor, course, cohort, teacher, teacherActor };
}

describe("createQuestion — ownership boundary + shape validation", () => {
  it("a teacher NOT assigned to the course cannot create a question", async () => {
    const { course } = await setupCourseWithTeacher();
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(
      createQuestion(course.id, { type: "single_choice", prompt: "Sneaky?", options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] }, outsiderActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("single_choice requires exactly one correct option", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();

    await expect(
      createQuestion(course.id, { type: "single_choice", prompt: "2+2?", options: [{ text: "3", isCorrect: false }, { text: "4", isCorrect: true }, { text: "5", isCorrect: true }] }, teacherActor)
    ).rejects.toThrow(/exactly one correct/);

    await expect(
      createQuestion(course.id, { type: "single_choice", prompt: "2+2?", options: [{ text: "3", isCorrect: false }, { text: "5", isCorrect: false }] }, teacherActor)
    ).rejects.toThrow(/at least one option/i);
  });

  it("multiple_choice allows several correct options", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const q = await createQuestion(
      course.id,
      { type: "multiple_choice", prompt: "Primes under 5?", options: [{ text: "2", isCorrect: true }, { text: "3", isCorrect: true }, { text: "4", isCorrect: false }] },
      teacherActor
    );
    expect(q.options).toHaveLength(3);
    expect(q.options.filter((o) => o.isCorrect)).toHaveLength(2);
  });

  it("short_answer needs no options; acceptableAnswers is optional", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const q = await createQuestion(course.id, { type: "short_answer", prompt: "Capital of Nigeria?", acceptableAnswers: ["Abuja"] }, teacherActor);
    expect(q.options).toHaveLength(0);
    expect(q.acceptableAnswers).toEqual(["Abuja"]);
  });

  it("an admin (courses.manage) can create content on any course without a cohort assignment", async () => {
    const { course, adminActor } = await setupCourseWithTeacher();
    await expect(
      createQuestion(course.id, { type: "short_answer", prompt: "Admin question?" }, adminActor)
    ).resolves.not.toThrow();
  });
});

describe("updateQuestion / archiveQuestion", () => {
  it("outsider teacher cannot update or archive", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const q = await createQuestion(course.id, { type: "short_answer", prompt: "Q?" }, teacherActor);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(updateQuestion(q.id, { prompt: "Edited" }, outsiderActor)).rejects.toThrow(AuthorizationError);
    await expect(archiveQuestion(q.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("archiveQuestion is a soft delete — the row still resolves afterward", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const q = await createQuestion(course.id, { type: "short_answer", prompt: "Q?" }, teacherActor);

    await archiveQuestion(q.id, teacherActor);
    const archived = await getQuestionById(q.id, teacherActor);
    expect(archived?.archivedAt).not.toBeNull();

    await unarchiveQuestion(q.id, teacherActor);
    const restored = await getQuestionById(q.id, teacherActor);
    expect(restored?.archivedAt).toBeNull();
  });

  it("listQuestionBank excludes archived questions by default", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const keep = await createQuestion(course.id, { type: "short_answer", prompt: "Keep" }, teacherActor);
    const drop = await createQuestion(course.id, { type: "short_answer", prompt: "Drop" }, teacherActor);
    await archiveQuestion(drop.id, teacherActor);

    const active = await listQuestionBank(course.id, {}, teacherActor);
    expect(active.map((q) => q.id)).toEqual([keep.id]);

    const all = await listQuestionBank(course.id, { includeArchived: true }, teacherActor);
    expect(all.map((q) => q.id).sort()).toEqual([keep.id, drop.id].sort());
  });

  it("replacing options revalidates single_choice shape", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const q = await createQuestion(
      course.id,
      { type: "single_choice", prompt: "Q?", options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] },
      teacherActor
    );

    await expect(
      updateQuestion(q.id, { options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: true }] }, teacherActor)
    ).rejects.toThrow(/exactly one correct/);
  });
});

describe("tagQuestion / untagQuestion — reuses the Topic taxonomy", () => {
  it("tags and untags a question, ownership-scoped", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const topic = await createTopic({ name: `Topic ${Date.now()}` }, adminActor);
    createdTopicIds.push(topic.id);

    const q = await createQuestion(course.id, { type: "short_answer", prompt: "Q?" }, teacherActor);
    await tagQuestion(q.id, topic.id, teacherActor);

    const tagged = await getQuestionById(q.id, teacherActor);
    expect(tagged?.topics.map((t) => t.topicId)).toEqual([topic.id]);

    await untagQuestion(q.id, topic.id, teacherActor);
    const untagged = await getQuestionById(q.id, teacherActor);
    expect(untagged?.topics).toHaveLength(0);
  });
});
