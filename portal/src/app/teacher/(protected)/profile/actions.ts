"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { updateUserProfile } from "@/lib/users";
import { OAUTH_LINK_INTENT_COOKIE, createLinkIntentValue } from "@/lib/oauth-link-intent";

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

/**
 * Self-service "connect Google" (Session 19). Mints a short-lived, signed
 * link-intent cookie identifying THIS authenticated user (never a
 * parameter an attacker could swap — always session.user.id), then hands
 * off to the exact same Google OAuth flow the login page's "Continue with
 * Google" button uses. src/lib/oauth-identity.ts's resolveGoogleSignIn()
 * reads that cookie to link the Google account completing the handshake to
 * this user — see its doc comment for the full linking rule.
 */
export async function connectGoogleAction() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");

  const store = await cookies();
  store.set(OAUTH_LINK_INTENT_COOKIE, createLinkIntentValue(session.user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });

  await signIn("google", { redirectTo: "/profile?linked=1" });
}
