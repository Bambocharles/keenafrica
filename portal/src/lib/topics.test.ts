import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse } from "@/lib/courses";
import { createLesson, createModule } from "@/lib/content";
import { createTopic, listTopics, tagLesson, untagLesson } from "@/lib/topics";
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
  await cleanupTestTopics(createdTopicIds);
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

describe("createTopic — authorization boundary", () => {
  it("requires topics.manage", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);
    await expect(createTopic({ name: "Mathematics" }, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("an admin can create a Subject -> Topic -> Skill hierarchy via parentId", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    const subject = await createTopic({ name: "Mathematics" }, adminActor);
    createdTopicIds.push(subject.id);
    const topic = await createTopic({ name: "Algebra", parentId: subject.id }, adminActor);
    createdTopicIds.push(topic.id);
    const skill = await createTopic({ name: "Linear equations", parentId: topic.id }, adminActor);
    createdTopicIds.push(skill.id);

    expect(topic.parentId).toBe(subject.id);
    expect(skill.parentId).toBe(topic.id);

    const all = await listTopics();
    expect(all.map((t) => t.id)).toEqual(expect.arrayContaining([subject.id, topic.id, skill.id]));
  });
});

describe("tagLesson / untagLesson — ownership boundary", () => {
  it("an outsider teacher cannot tag a lesson they don't own", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Tag Ownership Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const topic = await createTopic({ name: "Tagging Topic" }, adminActor);
    createdTopicIds.push(topic.id);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(tagLesson(lesson.id, topic.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("the owning teacher can tag and untag a lesson", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: "Tag Course" }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);
    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const topic = await createTopic({ name: "Real Tagging Topic" }, adminActor);
    createdTopicIds.push(topic.id);

    await tagLesson(lesson.id, topic.id, teacherActor);
    let tags = await prisma.lessonTopic.findMany({ where: { lessonId: lesson.id } });
    expect(tags.map((t) => t.topicId)).toEqual([topic.id]);

    // Idempotent
    await expect(tagLesson(lesson.id, topic.id, teacherActor)).resolves.not.toThrow();
    tags = await prisma.lessonTopic.findMany({ where: { lessonId: lesson.id } });
    expect(tags).toHaveLength(1);

    await untagLesson(lesson.id, topic.id, teacherActor);
    tags = await prisma.lessonTopic.findMany({ where: { lessonId: lesson.id } });
    expect(tags).toHaveLength(0);
  });
});
