"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signIn } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/password-reset";
import { sendMail } from "@/lib/mailer";
import { setNotificationPreference } from "@/lib/notifications";
import { OAUTH_LINK_INTENT_COOKIE, createLinkIntentValue } from "@/lib/oauth-link-intent";

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

/**
 * Session 39 (Keen Africans — Notifications). The one minimal on/off
 * toggle this session's brief asks for — see
 * src/lib/notifications.ts's setNotificationPreference() for the generic
 * (not Keen-Africans-specific) mechanism this calls. Hard-codes the single
 * notification type this session actually wired
 * ("article_unpublished_by_admin"); extending this to more types once
 * Session 38/40/42 land is a matter of adding more checkboxes to the form
 * below, not touching this action.
 */
export async function updateArticleUnpublishedPreferenceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = session.user;

  const enabled = formData.get("articleUnpublishedByAdmin") === "on";
  await setNotificationPreference(actor, "article_unpublished_by_admin", enabled);
  revalidatePath("/account");
}

/**
 * Session 40 (Keen Africans — LinkedIn Verification). Self-service
 * "connect LinkedIn" — identical shape to Session 19's connectGoogleAction
 * (see e.g. src/app/student/(protected)/profile/actions.ts): mints a
 * short-lived, signed link-intent cookie identifying THIS authenticated
 * user, then hands off to the LinkedIn OAuth flow. src/lib/oauth-
 * identity.ts's resolveLinkedInSignIn() reads that cookie to link the
 * account and moves verification status to 'linkedin_connected' — see its
 * own doc comment.
 */
export async function connectLinkedInAction() {
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

  await signIn("linkedin", { redirectTo: "/account?linkedinConnected=1" });
}
