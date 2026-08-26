"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { setFeatureFlag, type FeatureFlagKey } from "@/lib/feature-flags";

export async function toggleFeatureFlagAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const key = String(formData.get("key") ?? "") as FeatureFlagKey;
  const enabled = String(formData.get("enabled") ?? "") === "true";

  let error: string | null = null;
  try {
    await setFeatureFlag(key, enabled, actor);
  } catch (err) {
    error = err instanceof AuthorizationError ? "not_authorized" : "update_failed";
  }

  revalidatePath("/flags");
  if (error) redirect(`/flags?error=${error}`);
}
