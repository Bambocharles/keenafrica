"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";

/**
 * Self-service password reset — same shape as
 * src/app/student/(protected)/profile/actions.ts's
 * requestOwnPasswordResetAction (Session 02/03's original pattern):
 * requestPasswordReset() does no authorization of its own (it's designed
 * to be pre-auth-callable), so this action is only safe here because the
 * caller is already authenticated and is requesting a reset for their OWN
 * email, not an arbitrary address. The one-time link is also shown
 * directly (60s, httpOnly cookie) as a fallback alongside the real email,
 * same convention every other portal's self-service reset uses.
 */
export async function requestOwnPasswordResetAction() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Not authenticated");
  const actor = session.user;

  const { token } = await requestPasswordReset(actor.email!, actor.id);
  if (token) {
    const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
    const link = `https://keenafricans.${rootDomain}/reset-password?token=${token}`;

    try {
      await sendMail({
        to: actor.email!,
        subject: "Reset your Keen Africans password",
        text: `You requested a password reset link:\n\n${link}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, you can ignore it.`,
      });
    } catch {
      // The link below still works for the requester regardless of
      // whether delivery succeeded.
    }

    const store = await cookies();
    store.set("own_reset_link", link, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60,
      path: "/dashboard",
    });
  }

  redirect(token ? "/dashboard?resetLinkGenerated=1" : "/dashboard?error=reset_unavailable");
}
