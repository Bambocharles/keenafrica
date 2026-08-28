"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createOrganization } from "@/lib/organizations";
import { AuthorizationError, PERMISSIONS, requirePermission } from "@/lib/authz";

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
      // createOrganization() itself is deliberately open to any authenticated
      // actor (Session 18's self-service teacher/student onboarding depends
      // on that — see its own doc comment). This admin-console surface is
      // different: it's presented only inside the organizations.manage-gated
      // Platform Admin oversight page, so a crafted direct POST here must be
      // held to that same bar, not the library's broader default — found
      // live in Session 25 QA, where a TROUBLESHOOTER-role session (no
      // organizations.manage) could reach this action and become org_admin
      // of a newly-created organization despite the page itself correctly
      // hiding the form.
      requirePermission(actor, PERMISSIONS.ORGANIZATIONS_MANAGE);
      await createOrganization({ name, slug, type: type as never, description }, actor);
    } catch (err) {
      error = err instanceof AuthorizationError ? "not_authorized" : "create_failed";
    }
  }

  revalidatePath("/organizations");
  if (error) redirect(`/organizations?error=${error}`);
}
