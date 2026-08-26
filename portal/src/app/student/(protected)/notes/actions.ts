"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { deleteNote, updateNote } from "@/lib/notes";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function deleteNoteAction(formData: FormData) {
  const actor = await requireActor();
  const noteId = String(formData.get("noteId") ?? "");
  await deleteNote(noteId, actor);
  revalidatePath("/notes");
}

export async function updateNoteAction(formData: FormData) {
  const actor = await requireActor();
  const noteId = String(formData.get("noteId") ?? "");
  const body = String(formData.get("body") ?? "");
  await updateNote(noteId, body, actor);
  revalidatePath("/notes");
}
