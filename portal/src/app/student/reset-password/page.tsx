import { redirect } from "next/navigation";
import { resetPassword } from "@/lib/password-reset";
import styles from "../login/login.module.css";

/**
 * Public token-consumption page, same shape as /admin/reset-password —
 * resetPassword() itself works for any user regardless of which portal
 * generated the link (src/lib/password-reset.ts is a Platform Core
 * capability, not admin-specific). No student-portal auth required to
 * reach this: possession of the single-use token IS the proof of identity,
 * same as the admin-triggered flow.
 */
export default async function StudentResetPasswordPage({
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
          <p className={styles.subtitle}>This link is missing its token. Request a new one from your profile page.</p>
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
