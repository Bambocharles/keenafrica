"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import {
  addResource,
  createLesson,
  createModule,
  getCourseContentForTeacher,
  publishLesson,
  publishModule,
  removeResource,
  reorderLessons,
  reorderModules,
  unpublishLesson,
  unpublishModule,
  updateLesson,
  updateModule,
} from "@/lib/content";
import { tagLesson, untagLesson } from "@/lib/topics";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

async function finish(courseId: string, error: string | null) {
  revalidatePath(`/courses/${courseId}`);
  if (error) redirect(`/courses/${courseId}?error=${error}`);
}

export async function createModuleAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await createModule(courseId, { title }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(courseId, error);
}

export async function updateModuleAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  let error: string | null = null;
  if (!title) {
    error = "missing_fields";
  } else {
    try {
      await updateModule(moduleId, { title }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(courseId, error);
}

/** Swaps a module with its immediate predecessor/successor in display order. */
export async function moveModuleAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  let error: string | null = null;
  try {
    const content = await getCourseContentForTeacher(courseId, actor);
    const ids = (content?.modules ?? []).map((m) => m.id);
    const idx = ids.indexOf(moduleId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx >= 0 && swapWith >= 0 && swapWith < ids.length) {
      [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
      await reorderModules(courseId, ids, actor);
    }
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function publishModuleAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");

  let error: string | null = null;
  try {
    await publishModule(moduleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function unpublishModuleAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");

  let error: string | null = null;
  try {
    await unpublishModule(moduleId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function createLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  let error: string | null = null;
  if (!title || !content) {
    error = "missing_fields";
  } else {
    try {
      await createLesson(moduleId, { title, content }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(courseId, error);
}

export async function updateLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  let error: string | null = null;
  if (!title || !content) {
    error = "missing_fields";
  } else {
    try {
      await updateLesson(lessonId, { title, content }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(courseId, error);
}

/** Swaps a lesson with its immediate predecessor/successor within its module. */
export async function moveLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  let error: string | null = null;
  try {
    const content = await getCourseContentForTeacher(courseId, actor);
    const module = content?.modules.find((m) => m.id === moduleId);
    const ids = (module?.lessons ?? []).map((l) => l.id);
    const idx = ids.indexOf(lessonId);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (idx >= 0 && swapWith >= 0 && swapWith < ids.length) {
      [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
      await reorderLessons(moduleId, ids, actor);
    }
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function publishLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  let error: string | null = null;
  try {
    await publishLesson(lessonId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function unpublishLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  let error: string | null = null;
  try {
    await unpublishLesson(lessonId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function addResourceAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const type = String(formData.get("type") ?? "link");

  let error: string | null = null;
  if (!title || !url) {
    error = "missing_fields";
  } else {
    try {
      await addResource(lessonId, { title, url, type: type as "link" | "document" | "video" }, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(courseId, error);
}

export async function removeResourceAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const resourceId = String(formData.get("resourceId") ?? "");

  let error: string | null = null;
  try {
    await removeResource(resourceId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}

export async function tagLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const topicId = String(formData.get("topicId") ?? "");

  let error: string | null = null;
  if (!topicId) {
    error = "missing_fields";
  } else {
    try {
      await tagLesson(lessonId, topicId, actor);
    } catch (err) {
      error = toError(err);
    }
  }
  await finish(courseId, error);
}

export async function untagLessonAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const topicId = String(formData.get("topicId") ?? "");

  let error: string | null = null;
  try {
    await untagLesson(lessonId, topicId, actor);
  } catch (err) {
    error = toError(err);
  }
  await finish(courseId, error);
}
