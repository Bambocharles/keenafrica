"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { AuthzActor } from "@/lib/authz";
import { ProfileNotFoundError, UsernameTakenError, removeAvatar, setAvatar, updateProfile } from "@/lib/profiles";
import { FileTooLargeError, UnsupportedFileTypeError } from "@/lib/assets";

async function requireActor(): Promise<AuthzActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  if (err instanceof UsernameTakenError) return "username_taken";
  if (err instanceof ProfileNotFoundError) return "not_found";
  if (err instanceof UnsupportedFileTypeError) return "unsupported_file_type";
  if (err instanceof FileTooLargeError) return "file_too_large";
  if (err instanceof Error && err.message) return err.message;
  return "action_failed";
}

function finish(error: string | null) {
  revalidatePath("/profile");
  if (error) redirect(`/profile?error=${encodeURIComponent(error)}`);
  redirect("/profile?saved=1");
}

export async function updateMyProfileAction(formData: FormData) {
  const actor = await requireActor();

  const interests = String(formData.get("interests") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  let error: string | null = null;
  try {
    await updateProfile(actor, {
      username: String(formData.get("username") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      country: String(formData.get("country") ?? ""),
      profession: String(formData.get("profession") ?? ""),
      interests,
      linkedinUrl: String(formData.get("linkedinUrl") ?? ""),
      githubUrl: String(formData.get("githubUrl") ?? ""),
      websiteUrl: String(formData.get("websiteUrl") ?? ""),
      xUrl: String(formData.get("xUrl") ?? ""),
    });
  } catch (err) {
    error = toError(err);
  }
  finish(error);
}

export async function setAvatarAction(formData: FormData) {
  const actor = await requireActor();
  const file = formData.get("file");

  let error: string | null = null;
  if (!(file instanceof File) || file.size === 0) {
    error = "missing_fields";
  } else {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await setAvatar(actor, { originalFilename: file.name, declaredMimeType: file.type || "application/octet-stream", buffer });
    } catch (err) {
      error = toError(err);
    }
  }
  finish(error);
}

export async function removeAvatarAction() {
  const actor = await requireActor();
  let error: string | null = null;
  try {
    await removeAvatar(actor);
  } catch (err) {
    error = toError(err);
  }
  finish(error);
}
