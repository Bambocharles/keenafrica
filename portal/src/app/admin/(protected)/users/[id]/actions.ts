"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  AuthorizationError,
  PERMISSIONS,
  ROLE_NAMES,
  requireOwnResourceOrPermission,
  type RoleName,
} from "@/lib/authz";
import { assignRole, getUserById, reinstateUser, removeRole, suspendUser, updateUserProfile } from "@/lib/users";
import { revokeAllUserSessions, revokeSession } from "@/lib/sessions";
import { requestPasswordReset } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

function toError(err: unknown): string {
  return err instanceof AuthorizationError ? "not_authorized" : "action_failed";
}

export async function suspendUserAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || undefined;

  let error: string | null = null;
  try {
    await suspendUser(targetUserId, actor, reason);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

export async function reinstateUserAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");

  let error: string | null = null;
  try {
    await reinstateUser(targetUserId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

export async function updateNameAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  let error: string | null = null;
  if (!name) {
    error = "missing_fields";
  } else {
    try {
      await updateUserProfile(targetUserId, { name }, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

export async function assignRoleAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  let error: string | null = null;
  if (!(ROLE_NAMES as readonly string[]).includes(role)) {
    error = "invalid_role";
  } else {
    try {
      await assignRole(targetUserId, role as RoleName, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

export async function removeRoleAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  let error: string | null = null;
  if (!(ROLE_NAMES as readonly string[]).includes(role)) {
    error = "invalid_role";
  } else {
    try {
      await removeRole(targetUserId, role as RoleName, actor);
    } catch (err) {
      error = toError(err);
    }
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

export async function revokeSessionAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");

  let error: string | null = null;
  try {
    await revokeSession(sessionId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

export async function revokeAllSessionsAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");

  let error: string | null = null;
  try {
    await revokeAllUserSessions(targetUserId, actor);
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/users/${targetUserId}`);
  if (error) redirect(`/users/${targetUserId}?error=${error}`);
}

/**
 * Admin-triggered password reset. requestPasswordReset() itself is
 * intentionally callable pre-auth (it's the future public "forgot
 * password" contract too) and does no authorization of its own — this
 * action IS the authorization boundary for "may this caller generate a
 * reset link for an arbitrary other user." Gated on users.update since it
 * mutates another account's credential state, same tier as
 * updateUserProfile().
 *
 * No transactional email provider exists yet (see docs/IDENTITY_SECURITY.md
 * "Blockers") — sendMail() throws in production, dev-console-logs
 * otherwise. Either way we still stash the raw one-time link in a short-
 * lived cookie so the *authorized admin who triggered this* (not the
 * target) can relay it out of band. The cookie is scoped to this page,
 * self-expires in 60s, and the underlying token is already single-use and
 * DB-expires in 1h regardless (src/lib/password-reset.ts).
 */
export async function triggerPasswordResetAction(formData: FormData) {
  const actor = await requireActor();
  const targetUserId = String(formData.get("userId") ?? "");

  let error: string | null = null;
  let success = false;
  try {
    requireOwnResourceOrPermission(actor, targetUserId, PERMISSIONS.USERS_UPDATE);
    const target = await getUserById(targetUserId, actor);
    if (!target) throw new Error("User not found");

    const { token } = await requestPasswordReset(target.email, actor.id);
    if (!token) {
      error = "reset_unavailable";
    } else {
      const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
      const link = `https://admin.${rootDomain}/reset-password?token=${token}`;

      try {
        await sendMail({
          to: target.email,
          subject: "Reset your Keen Africa admin password",
          text: `An administrator generated a password reset link for your account:\n\n${link}\n\nThis link expires in 1 hour and can only be used once. If you didn't expect this, contact your administrator.`,
        });
      } catch {
        // Expected in production until an email provider is wired up — the
        // admin still gets the link below to relay manually.
      }

      const store = await cookies();
      store.set(`reset_link_${targetUserId}`, link, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60,
        path: `/users/${targetUserId}`,
      });
      success = true;
    }
  } catch (err) {
    error = toError(err);
  }

  revalidatePath(`/users/${targetUserId}`);
  redirect(`/users/${targetUserId}${success ? "?resetLinkGenerated=1" : error ? `?error=${error}` : ""}`);
}
