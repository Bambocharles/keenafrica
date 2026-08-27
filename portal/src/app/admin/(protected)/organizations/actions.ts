"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createOrganization } from "@/lib/organizations";
import { AuthorizationError } from "@/lib/authz";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function createOrganizationAction(formData: FormData) {
  const actor = await requireActor();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const type = String(formData.get("type") ?? "other");
  const description = String(formData.get("description") ?? "");

  let error: string | null = null;
  if (!name || !slug) {
    error = "missing_fields";
  } else {
    try {
      await createOrganization({ name, slug, type: type as never, description }, actor);
    } catch (err) {
      error = err instanceof AuthorizationError ? "not_authorized" : "create_failed";
    }
  }

  revalidatePath("/organizations");
  if (error) redirect(`/organizations?error=${error}`);
}
