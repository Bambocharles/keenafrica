"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { createNote, deleteNote } from "@/lib/notes";
import { addBookmark, removeBookmark } from "@/lib/bookmarks";
import { markLessonComplete } from "@/lib/progress";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

export async function addLessonNoteAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  let error: string | null = null;
  if (!body) {
    error = "missing_fields";
  } else {
    try {
      await createNote({ courseId, targetType: "lesson", targetId: lessonId, body }, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
  if (error) redirect(`/courses/${courseId}/lessons/${lessonId}?error=${error}`);
}

export async function deleteLessonNoteAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const noteId = String(formData.get("noteId") ?? "");

  let error: string | null = null;
  try {
    await deleteNote(noteId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
  if (error) redirect(`/courses/${courseId}/lessons/${lessonId}?error=${error}`);
}

export async function addLessonBookmarkAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  let error: string | null = null;
  try {
    await addBookmark({ courseId, targetType: "lesson", targetId: lessonId }, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
  if (error) redirect(`/courses/${courseId}/lessons/${lessonId}?error=${error}`);
}

export async function markLessonCompleteAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  let error: string | null = null;
  try {
    await markLessonComplete(courseId, lessonId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
  revalidatePath(`/progress`);
  revalidatePath(`/courses/${courseId}`);
  if (error) redirect(`/courses/${courseId}/lessons/${lessonId}?error=${error}`);
}

export async function removeLessonBookmarkAction(formData: FormData) {
  const actor = await requireActor();
  const courseId = String(formData.get("courseId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const bookmarkId = String(formData.get("bookmarkId") ?? "");

  let error: string | null = null;
  try {
    await removeBookmark(bookmarkId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/courses/${courseId}/lessons/${lessonId}`);
  if (error) redirect(`/courses/${courseId}/lessons/${lessonId}?error=${error}`);
}
