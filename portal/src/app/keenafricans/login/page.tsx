import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import styles from "./login.module.css";

// Session 19 (Federated Auth) — matches the codes src/lib/auth.ts's signIn
// callback redirects to on a rejected Google sign-in
// (GOOGLE_REJECTION_ERROR_CODES). Mirrors teacher/student's login page.
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_no_email: "Your Google account has no email address to sign in with.",
  google_email_exists:
    "An account with this email already exists. Sign in with your password, then connect Google from your profile.",
  google_no_account: "Could not sign you in with Google right now — try again shortly.",
  google_conflicting_link: "This Google account is already connected to a different account.",
  google_account_suspended: "This account has been suspended.",
};

export default async function KeenAfricansLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const session = await auth();
  if (session?.user?.mfaPending) {
    redirect("/mfa");
  }
  if (canAccessKeenAfricanPortal(session?.user)) {
    redirect("/dashboard");
  }
  const { error, reset } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  async function googleLogin() {
    "use server";
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>K</div>
        <h1 className={styles.title}>Keen Africans</h1>
        <p className={styles.subtitle}>Sign in to write and publish your articles</p>

        {error && error !== "1" && GOOGLE_ERROR_MESSAGES[error] && (
          <div className={styles.error} role="alert">
            {GOOGLE_ERROR_MESSAGES[error]}
          </div>
        )}
        {error === "1" && (
          <div className={styles.error} role="alert">
            Invalid email or password. Check both and try again.
          </div>
        )}
        {reset === "1" && !error && (
          <div
            className={styles.error}
            role="status"
            style={{ background: "rgba(63, 182, 143, 0.14)", borderColor: "rgba(63, 182, 143, 0.35)", color: "#5fce9e" }}
          >
            Password updated. Sign in with your new password.
          </div>
        )}

        <form action={login}>
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
              autoComplete="current-password"
              required
              className={styles.input}
            />
          </div>
          <button type="submit" className={styles.submit}>
            Log in
          </button>
        </form>

        <div className={styles.divider}>or</div>

        <form action={googleLogin}>
          <button type="submit" className={styles.oauth}>
            Continue with Google
          </button>
        </form>

        <p className={styles.subtitle} style={{ marginTop: "16px", marginBottom: 0 }}>
          New here? <a href="/register">Become a Keen African</a>
        </p>
        <p className={styles.subtitle} style={{ marginTop: "10px", marginBottom: 0 }}>
          <a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a>
        </p>
      </div>
    </div>
  );
}
