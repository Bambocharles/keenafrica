import { withRls } from "@/lib/rls";
import { PERMISSIONS, requirePermission, type AuthzActor } from "@/lib/authz";
import { actorRlsCtx, requireCourseContentAccess } from "@/lib/courses";

/**
 * Education Core (Session 04) — Subject -> Topic -> Subtopic/Skill
 * taxonomy, modeled as one self-referential Topic table (see schema.prisma
 * comment). Public read (catalog table, like roles/permissions/feature_flags);
 * write requires topics.manage. Tags Lesson content today — Session 07
 * (Assessment) is expected to reuse this same table for Question tagging.
 */

export interface CreateTopicInput {
  name: string;
  parentId?: string;
}

export async function createTopic(input: CreateTopicInput, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.TOPICS_MANAGE);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.topic.create({ data: { name: input.name, parentId: input.parentId } })
  );
}

/** Public read — no permission required, mirrors roles/permissions catalog tables. */
export async function listTopics() {
  return withRls({}, (tx) => tx.topic.findMany({ orderBy: { name: "asc" } }));
}

export async function tagLesson(lessonId: string, topicId: string, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.lessonTopic.upsert({
      where: { lessonId_topicId: { lessonId, topicId } },
      create: { lessonId, topicId },
      update: {},
    })
  );
}

export async function untagLesson(lessonId: string, topicId: string, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), (tx) => tx.lessonTopic.deleteMany({ where: { lessonId, topicId } }));
}
