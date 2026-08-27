"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError, type AuthzActor } from "@/lib/authz";
import { FileTooLargeError, UnsupportedFileTypeError } from "@/lib/assets";
import { markConversationRead, sendMessage, startConversation } from "@/lib/messaging";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  if (err instanceof AuthorizationError) return "not_authorized";
  if (err instanceof UnsupportedFileTypeError) return "unsupported_file_type";
  if (err instanceof FileTooLargeError) return "file_too_large";
  return "action_failed";
}

async function attachmentFromFormData(formData: FormData) {
  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) return undefined;
  const buffer = Buffer.from(await file.arrayBuffer());
  return { originalFilename: file.name, declaredMimeType: file.type || "application/octet-stream", buffer };
}

export async function startDirectConversationAction(formData: FormData) {
  const actor = await requireActor();
  const recipientId = String(formData.get("recipientId") ?? "");
  const body = String(formData.get("body") ?? "");

  let error: string | null = null;
  let conversationId: string | null = null;
  if (!recipientId || !body.trim()) {
    error = "missing_fields";
  } else {
    try {
      const attachment = await attachmentFromFormData(formData);
      const { conversation } = await startConversation({ type: "direct", participantIds: [recipientId], body, attachment }, actor);
      conversationId = conversation.id;
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath("/messages");
  if (error) redirect(`/messages/new?error=${error}`);
  redirect(`/messages/${conversationId}`);
}

export async function replyAction(formData: FormData) {
  const actor = await requireActor();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "");

  let error: string | null = null;
  if (!body.trim()) {
    error = "missing_fields";
  } else {
    try {
      const attachment = await attachmentFromFormData(formData);
      await sendMessage(conversationId, { body, attachment }, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/messages");
  if (error) redirect(`/messages/${conversationId}?error=${error}`);
  redirect(`/messages/${conversationId}`);
}

export async function markReadAction(formData: FormData) {
  const actor = await requireActor();
  const conversationId = String(formData.get("conversationId") ?? "");
  await markConversationRead(conversationId, actor).catch(() => {});
  revalidatePath(`/messages/${conversationId}`);
  revalidatePath("/messages");
}
