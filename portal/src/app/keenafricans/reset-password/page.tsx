import { redirect } from "next/navigation";
import { resetPassword } from "@/lib/password-reset";
import styles from "../login/login.module.css";

/**
 * Public token-consumption page, same shape as /student/reset-password —
 * resetPassword() itself works for any user regardless of which portal
 * generated the link (src/lib/password-reset.ts is a Platform Core
 * capability, not portal-specific). No keenafricans-portal auth required
 * to reach this: possession of the single-use token IS the proof of
 * identity. There is still no pre-login "forgot password" entry point
 * anywhere on this platform (a request can only be started from a
 * protected profile page, or triggered by an admin on someone's behalf —
 * see docs/B2B_B2C_ONBOARDING.md's own "Known limitations") — this page
 * exists so a link an admin sends a Keen African resolves on their own
 * subdomain rather than only working via admin.<root>/reset-password.
 */
export default async function KeenAfricansResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.mark}>K</div>
          <h1 className={styles.title}>Invalid reset link</h1>
          <p className={styles.subtitle}>This link is missing its token. Ask an admin to send you a new one.</p>
        </div>
      </div>
    );
  }

  async function submit(formData: FormData) {
    "use server";
    const newPassword = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const t = String(formData.get("token") ?? "");

    if (newPassword.length < 8 || newPassword !== confirm) {
      redirect(`/reset-password?token=${encodeURIComponent(t)}&error=1`);
    }

    const outcome = await resetPassword(t, newPassword);
    if (outcome !== "ok") {
      redirect(`/reset-password?token=${encodeURIComponent(t)}&error=1`);
    }
    redirect("/login?reset=1");
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>K</div>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.subtitle}>This link can only be used once.</p>

        {error && (
          <div className={styles.error} role="alert">
            That link is invalid or expired, or the passwords didn&apos;t match (min. 8 characters).
          </div>
        )}

        <form action={submit}>
          <input type="hidden" name="token" value={token} />
          <div className={styles.field}>
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className={styles.input}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className={styles.input}
            />
          </div>
          <button type="submit" className={styles.submit}>
            Set password
          </button>
        </form>
      </div>
    </div>
  );
}
