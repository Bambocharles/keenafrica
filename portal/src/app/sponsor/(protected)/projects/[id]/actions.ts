"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { addProjectTeamMember, removeProjectTeamMember } from "@/lib/sponsor";

function toError(err: unknown): string {
  return err instanceof Error ? err.message : "action_failed";
}

export async function inviteTeamMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const projectId = String(formData.get("projectId") ?? "");
  const email = String(formData.get("email") ?? "");

  let error: string | null = null;
  let notice: string | null = null;
  try {
    const result = await addProjectTeamMember(projectId, email, actor);
    if (result.needsRoleGrant) {
      notice = "member_added_needs_role";
    }
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/projects/${projectId}`);
  if (error) redirect(`/projects/${projectId}?error=${encodeURIComponent(error)}`);
  redirect(`/projects/${projectId}${notice ? `?notice=${notice}` : "?success=1"}`);
}

export async function removeTeamMemberAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const projectId = String(formData.get("projectId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  let error: string | null = null;
  try {
    await removeProjectTeamMember(projectId, userId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/projects/${projectId}`);
  if (error) redirect(`/projects/${projectId}?error=${encodeURIComponent(error)}`);
  redirect(`/projects/${projectId}?success=1`);
}
