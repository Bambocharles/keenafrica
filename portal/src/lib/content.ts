import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx, assertActiveEnrollment, isCourseTeacher, requireCourseContentAccess } from "@/lib/courses";
import { deleteAssetIfOrphanedAsContentOwner, uploadAsset } from "@/lib/assets";

/**
 * Education Core (Session 04) — Module, Lesson, LessonVersion, Resource.
 *
 * Content lifecycle: draft (invisible to students) -> published (visible to
 * enrolled students) -> back to draft (unpublish) any number of times. Every
 * publish snapshots the lesson into an immutable LessonVersion row first —
 * the versioning foundation the session brief calls for, so a later draft
 * edit never silently rewrites what an already-published lesson said.
 *
 * Every mutation here re-derives the owning course id and calls
 * requireCourseContentAccess() (src/lib/courses.ts) — the same ownership
 * check the RLS policies enforce independently at the database level.
 */

async function nextModuleOrder(courseId: string, actor: AuthzActor): Promise<number> {
  const max = await withRls(actorRlsCtx(actor), (tx) =>
    tx.module.aggregate({ where: { courseId }, _max: { order: true } })
  );
  return (max._max.order ?? -1) + 1;
}

async function nextLessonOrder(moduleId: string, actor: AuthzActor): Promise<number> {
  const max = await withRls(actorRlsCtx(actor), (tx) =>
    tx.lesson.aggregate({ where: { moduleId }, _max: { order: true } })
  );
  return (max._max.order ?? -1) + 1;
}

// --- Module ---------------------------------------------------------------

export interface CreateModuleInput {
  title: string;
  order?: number;
}

export async function createModule(courseId: string, input: CreateModuleInput, actor: AuthzActor) {
  await requireCourseContentAccess(courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const order = input.order ?? (await nextModuleOrder(courseId, actor));
  const module = await withRls(actorRlsCtx(actor), (tx) =>
    tx.module.create({ data: { courseId, title: input.title, order } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "module.created", entityType: "Module", entityId: module.id, metadata: { courseId } });

  return module;
}

export async function updateModule(moduleId: string, data: { title?: string }, actor: AuthzActor) {
  const module = await withRls(actorRlsCtx(actor), (tx) => tx.module.findUnique({ where: { id: moduleId }, select: { courseId: true } }));
  if (!module) throw new Error("Module not found");
  await requireCourseContentAccess(module.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  return withRls(actorRlsCtx(actor), (tx) => tx.module.update({ where: { id: moduleId }, data }));
}

export async function reorderModules(courseId: string, orderedModuleIds: string[], actor: AuthzActor) {
  await requireCourseContentAccess(courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), async (tx) => {
    for (let i = 0; i < orderedModuleIds.length; i++) {
      await tx.module.update({ where: { id: orderedModuleIds[i] }, data: { order: i } });
    }
  });
}

export async function publishModule(moduleId: string, actor: AuthzActor) {
  const module = await withRls(actorRlsCtx(actor), (tx) => tx.module.findUnique({ where: { id: moduleId }, select: { courseId: true } }));
  if (!module) throw new Error("Module not found");
  await requireCourseContentAccess(module.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.module.update({ where: { id: moduleId }, data: { status: "published", publishedAt: new Date() } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "module.published", entityType: "Module", entityId: moduleId });
}

export async function unpublishModule(moduleId: string, actor: AuthzActor) {
  const module = await withRls(actorRlsCtx(actor), (tx) => tx.module.findUnique({ where: { id: moduleId }, select: { courseId: true } }));
  if (!module) throw new Error("Module not found");
  await requireCourseContentAccess(module.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) => tx.module.update({ where: { id: moduleId }, data: { status: "draft" } }));

  await recordAuditEvent({ actorId: actor.id, action: "module.unpublished", entityType: "Module", entityId: moduleId });
}

// --- Lesson -----------------------------------------------------------

export interface CreateLessonInput {
  title: string;
  content: string;
  order?: number;
}

export async function createLesson(moduleId: string, input: CreateLessonInput, actor: AuthzActor) {
  const module = await withRls(actorRlsCtx(actor), (tx) => tx.module.findUnique({ where: { id: moduleId }, select: { courseId: true } }));
  if (!module) throw new Error("Module not found");
  await requireCourseContentAccess(module.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const order = input.order ?? (await nextLessonOrder(moduleId, actor));
  const lesson = await withRls(actorRlsCtx(actor), (tx) =>
    tx.lesson.create({
      data: { moduleId, courseId: module.courseId, title: input.title, content: input.content, order },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "lesson.created", entityType: "Lesson", entityId: lesson.id, metadata: { moduleId } });

  return lesson;
}

export async function updateLesson(lessonId: string, data: { title?: string; content?: string }, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  return withRls(actorRlsCtx(actor), (tx) => tx.lesson.update({ where: { id: lessonId }, data }));
}

export async function reorderLessons(moduleId: string, orderedLessonIds: string[], actor: AuthzActor) {
  const module = await withRls(actorRlsCtx(actor), (tx) => tx.module.findUnique({ where: { id: moduleId }, select: { courseId: true } }));
  if (!module) throw new Error("Module not found");
  await requireCourseContentAccess(module.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  await withRls(actorRlsCtx(actor), async (tx) => {
    for (let i = 0; i < orderedLessonIds.length; i++) {
      await tx.lesson.update({ where: { id: orderedLessonIds[i] }, data: { order: i } });
    }
  });
}

/**
 * Publishes a lesson: snapshots the current title/content into an immutable
 * LessonVersion row, bumps Lesson.version, sets status=published. This is
 * the content-versioning foundation the session brief calls for.
 */
export async function publishLesson(lessonId: string, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  const nextVersion = lesson.version + 1;

  await withRls(actorRlsCtx(actor), async (tx) => {
    await tx.lessonVersion.create({
      data: {
        lessonId,
        version: nextVersion,
        title: lesson.title,
        content: lesson.content,
        publishedBy: actor.id,
      },
    });
    await tx.lesson.update({
      where: { id: lessonId },
      data: { status: "published", version: nextVersion, publishedAt: new Date() },
    });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "lesson.published",
    entityType: "Lesson",
    entityId: lessonId,
    metadata: { version: nextVersion },
  });
}

export async function unpublishLesson(lessonId: string, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_PUBLISH);

  await withRls(actorRlsCtx(actor), (tx) => tx.lesson.update({ where: { id: lessonId }, data: { status: "draft" } }));

  await recordAuditEvent({ actorId: actor.id, action: "lesson.unpublished", entityType: "Lesson", entityId: lessonId });
}

/** Requires courses.manage, super_admin, or being a teacher on the course — returns ALL statuses (draft included). */
export async function getCourseContentForTeacher(courseId: string, actor: AuthzActor) {
  await requireCourseContentAccessRead(courseId, actor);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              include: { resources: true, topics: { include: { topic: true } } },
            },
          },
        },
      },
    })
  );
}

/**
 * Read access mirrors requireCourseContentAccess's ownership shape, but
 * either content permission (write OR publish) is enough to view drafts —
 * unlike a mutation, which requires the specific permission for the action
 * being performed.
 */
async function requireCourseContentAccessRead(courseId: string, actor: AuthzActor): Promise<void> {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.COURSES_MANAGE)) return;
  if (!hasPermission(actor, PERMISSIONS.COURSES_CONTENT_WRITE) && !hasPermission(actor, PERMISSIONS.COURSES_CONTENT_PUBLISH)) {
    throw new AuthorizationError("Not authorized");
  }
  if (!(await isCourseTeacher(courseId, actor))) {
    throw new AuthorizationError("Not assigned to teach this course");
  }
}

/**
 * Student-facing read: only published modules/lessons, only for an actively
 * enrolled student. This is the server-side enforcement the acceptance
 * criteria calls for — draft content is filtered out here AND independently
 * by the lessons_select/modules_select RLS policies (defense in depth).
 */
export async function getCourseContentForStudent(courseId: string, actor: AuthzActor) {
  await assertActiveEnrollment(courseId, actor);

  return withRls(actorRlsCtx(actor), (tx) =>
    tx.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          where: { status: "published" },
          orderBy: { order: "asc" },
          include: {
            lessons: {
              where: { status: "published" },
              orderBy: { order: "asc" },
              include: { resources: true },
            },
          },
        },
      },
    })
  );
}

// --- Resource -----------------------------------------------------------

export interface AddResourceInput {
  title: string;
  url: string;
  type?: "link" | "document" | "video";
}

export async function addResource(lessonId: string, input: AddResourceInput, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const resource = await withRls(actorRlsCtx(actor), (tx) =>
    tx.resource.create({
      data: { lessonId, title: input.title, url: input.url, type: input.type ?? "link", createdBy: actor.id },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "resource.added", entityType: "Resource", entityId: resource.id, metadata: { lessonId } });

  return resource;
}

/**
 * Upload-backed resource (Session 13's Asset/File service) — the real,
 * upload-backed counterpart to addResource()'s external-link case. Same
 * ownership gate, same lesson resolution; the only difference is the file
 * goes through uploadAsset() (storage write + Asset row) and the Resource
 * row references it via assetId instead of an external url.
 */
export interface AddUploadedResourceInput {
  title: string;
  type?: "link" | "document" | "video";
  originalFilename: string;
  declaredMimeType: string;
  buffer: Buffer;
}

export async function addResourceFromUpload(lessonId: string, input: AddUploadedResourceInput, actor: AuthzActor) {
  const lesson = await withRls(actorRlsCtx(actor), (tx) => tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } }));
  if (!lesson) throw new Error("Lesson not found");
  await requireCourseContentAccess(lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  const asset = await uploadAsset(
    { originalFilename: input.originalFilename, declaredMimeType: input.declaredMimeType, buffer: input.buffer },
    actor
  );

  try {
    const resource = await withRls(actorRlsCtx(actor), async (tx) => {
      const created = await tx.resource.create({
        data: { lessonId, title: input.title, type: input.type ?? "document", assetId: asset.id, createdBy: actor.id },
      });
      await tx.assetAttachment.create({
        data: { assetId: asset.id, entityType: "lesson_resource", entityId: created.id, attachedBy: actor.id },
      });
      return created;
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "resource.added",
      entityType: "Resource",
      entityId: resource.id,
      metadata: { lessonId, assetId: asset.id },
    });

    return resource;
  } catch (err) {
    await deleteAssetIfOrphanedAsContentOwner(asset.id, actor).catch(() => {});
    throw err;
  }
}

export async function removeResource(resourceId: string, actor: AuthzActor) {
  const resource = await withRls(actorRlsCtx(actor), (tx) =>
    tx.resource.findUnique({
      where: { id: resourceId },
      select: { lessonId: true, assetId: true, lesson: { select: { courseId: true } } },
    })
  );
  if (!resource) throw new Error("Resource not found");
  await requireCourseContentAccess(resource.lesson.courseId, actor, PERMISSIONS.COURSES_CONTENT_WRITE);

  // Detach BEFORE deleting the Resource row — asset_attachments_delete's
  // RLS policy re-derives ownership through the still-existing resource;
  // deleting the resource first would make that ownership check
  // unresolvable (see the migration's RLS comment).
  await withRls(actorRlsCtx(actor), async (tx) => {
    if (resource.assetId) {
      await tx.assetAttachment.deleteMany({ where: { entityType: "lesson_resource", entityId: resourceId } });
    }
    await tx.resource.delete({ where: { id: resourceId } });
  });

  if (resource.assetId) {
    await deleteAssetIfOrphanedAsContentOwner(resource.assetId, actor).catch(() => {});
  }

  await recordAuditEvent({ actorId: actor.id, action: "resource.removed", entityType: "Resource", entityId: resourceId });
}
