"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { updateUserProfile } from "@/lib/users";

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

export async function updateProfileAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const name = String(formData.get("name") ?? "").trim();

  let error: string | null = null;
  if (!name) {
    error = "missing_fields";
  } else {
    try {
      await updateUserProfile(actor.id, { name }, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath("/profile");
  if (error) redirect(`/profile?error=${error}`);
  redirect("/profile?success=1");
}
