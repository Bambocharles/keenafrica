import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { canAccessTeacherPortal } from "@/lib/authz";
import { registerUser } from "@/lib/registration";
import styles from "../login/login.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Enter a valid name and email address.",
  weak_password: "Password must be at least 8 characters.",
  password_mismatch: "Passwords don't match.",
  email_taken: "An account already exists for that email — try logging in instead.",
  signin_failed: "Account created, but automatic sign-in failed. Please log in.",
};

/**
 * Public self-service registration (Session 18). Teachers register here;
 * students register at the equivalent student.<root>/register — the
 * subdomain IS the platform-role choice, same convention as /login being
 * split per portal. Reuses src/lib/registration.ts's registerUser() (the
 * only other path that may create a "users" row besides admin-provisioned
 * src/lib/users.ts's createUser()) and then signs the new account in
 * through the exact same Auth.js Credentials flow /login uses — no second
 * session mechanism.
 *
 * `?invite=<token>` carries an email-based OrganizationInvitation token
 * through registration (see src/lib/organizations.ts's
 * inviteToOrganization "email_invitation" branch) — redemption itself
 * happens on /onboarding right after sign-in, once a real actor exists.
 */
export default async function TeacherRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invite?: string }>;
}) {
  const session = await auth();
  if (canAccessTeacherPortal(session?.user)) {
    redirect("/dashboard");
  }
  const { error, invite } = await searchParams;

  async function register(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const inviteToken = String(formData.get("invite") ?? "");
    const qs = inviteToken ? `&invite=${encodeURIComponent(inviteToken)}` : "";

    if (password !== confirm) {
      redirect(`/register?error=password_mismatch${qs}`);
    }

    const outcome = await registerUser({ name, email, password, role: "TEACHER" });
    if (!outcome.ok) {
      redirect(`/register?error=${outcome.error}${qs}`);
    }

    const redirectTo = inviteToken ? `/onboarding?invite=${encodeURIComponent(inviteToken)}` : "/onboarding";
    try {
      await signIn("credentials", { email, password, redirectTo });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login");
      }
      throw err;
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>K</div>
        <h1 className={styles.title}>Create your teacher account</h1>
        <p className={styles.subtitle}>Deliver courses and manage cohorts on Keen Africa</p>

        {error && (
          <div className={styles.error} role="alert">
            {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
          </div>
        )}

        <form action={register}>
          <input type="hidden" name="invite" value={invite ?? ""} />
          <div className={styles.field}>
            <label htmlFor="name">Full name</label>
            <input id="name" name="name" type="text" autoComplete="name" required className={styles.input} />
          </div>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className={styles.input} />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
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
            Create account
          </button>
        </form>

        <p className={styles.subtitle} style={{ marginTop: "16px", marginBottom: 0 }}>
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
    </div>
  );
}
