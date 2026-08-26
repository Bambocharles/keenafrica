"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { AuthorizationError, ROLE_NAMES, type RoleName } from "@/lib/authz";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

export async function createUserAction(formData: FormData) {
  const actor = await requireActor();

  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const roles = formData
    .getAll("roles")
    .map(String)
    .filter((r): r is RoleName => (ROLE_NAMES as readonly string[]).includes(r));

  let error: string | null = null;
  if (!email || !name || !password) {
    error = "missing_fields";
  } else if (roles.length === 0) {
    error = "no_roles";
  } else {
    try {
      await createUser({ email, name, password, roles }, actor);
    } catch (err) {
      error = err instanceof AuthorizationError ? "not_authorized" : "create_failed";
    }
  }

  revalidatePath("/users");
  if (error) redirect(`/users?error=${error}`);
}
