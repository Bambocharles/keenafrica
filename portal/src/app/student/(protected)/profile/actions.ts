"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";

/**
 * Self-service password reset. requestPasswordReset() does no authorization
 * of its own (it's designed to be pre-auth-callable — see
 * src/lib/password-reset.ts) — this action is safe here specifically
 * because the caller is already authenticated AND is requesting a reset
 * for their OWN email, not an arbitrary address (unlike Session 03's
 * admin-triggered path, which acts on someone else's account and is gated
 * on users.update). Same short-lived-cookie delivery shape Session 03
 * established: no transactional email provider exists yet (see
 * docs/IDENTITY_SECURITY.md "Blockers"), so the raw one-time link is shown
 * directly to the account owner who just proved their identity by being
 * logged in, rather than left undeliverable.
 */
export async function requestOwnPasswordResetAction() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Not authenticated");
  const actor = session.user;

  const { token } = await requestPasswordReset(actor.email!, actor.id);
  if (token) {
    const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
    const link = `https://student.${rootDomain}/reset-password?token=${token}`;

    try {
      await sendMail({
        to: actor.email!,
        subject: "Reset your Keen Africa student password",
        text: `You requested a password reset link:\n\n${link}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, you can ignore it.`,
      });
    } catch {
      // Expected in production until an email provider is wired up (Session
      // 02 blocker) — the link below still works for the requester.
    }

    const store = await cookies();
    store.set("own_reset_link", link, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60,
      path: "/profile",
    });
  }

  redirect(token ? "/profile?resetLinkGenerated=1" : "/profile?error=reset_unavailable");
}
