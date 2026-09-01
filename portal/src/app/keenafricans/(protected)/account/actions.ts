"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";

/**
 * Self-service password reset — moved here from the dashboard's old
 * embedded "Account" card (Session 34 follow-up) so Profile (public) and
 * Account (private) are two distinct destinations, per this session's own
 * explicit rule. Same requestPasswordReset()/cookie-fallback shape every
 * other portal's self-service reset already uses; see
 * src/app/student/(protected)/profile/actions.ts's
 * requestOwnPasswordResetAction for the original pattern this mirrors.
 *
 * Email/password-change and MFA/security enrollment are Session 37's
 * territory (this session's own explicit "Account is Session 37's
 * territory: email, password, security") — this page is intentionally
 * minimal today, structurally open to that session adding more here.
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
      path: "/account",
    });
  }

  redirect(token ? "/account?resetLinkGenerated=1" : "/account?error=reset_unavailable");
}
