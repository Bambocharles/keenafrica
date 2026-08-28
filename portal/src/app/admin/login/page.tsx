import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { canAccessAdminConsole } from "@/lib/authz";
import styles from "./login.module.css";

// Session 19 (Federated Auth) — matches the codes src/lib/auth.ts's signIn
// callback redirects to on a rejected Google sign-in
// (GOOGLE_REJECTION_ERROR_CODES). google_no_account is the expected/common
// case here specifically: admin has no public signup path (Session 18's
// "Must NOT: no public path to an ADMIN/SPONSOR_* account"), so a Google
// account with no existing linked/matching admin User is always rejected,
// never auto-created.
const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_no_email: "Your Google account has no email address to sign in with.",
  google_email_exists:
    "An account with this email already exists. Sign in with your password, then connect Google from your profile.",
  google_no_account: "No admin account is linked to that Google account.",
  google_conflicting_link: "This Google account is already connected to a different account.",
  google_account_suspended: "This account has been suspended.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const session = await auth();
  if (canAccessAdminConsole(session?.user)) {
    // Relative to this subdomain - middleware prepends "/admin" on the
    // fresh request this redirect triggers. An absolute "/admin/..." path
    // here would get double-prefixed into a route that doesn't exist.
    redirect("/dashboard");
  }
  const { error, reset } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: "/dashboard",
      });
    } catch (err) {
      // signIn() throws Next.js's internal redirect signal on SUCCESS too -
      // catching indiscriminately here silently turned every successful
      // login into a reported failure. Only AuthError is a real auth
      // failure; anything else (including that signal) must be re-thrown
      // so Next.js can actually perform the redirect.
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
        <h1 className={styles.title}>Keen Africa Admin</h1>
        <p className={styles.subtitle}>Sign in to manage sponsors and projects</p>

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
          <div className={styles.error} role="status" style={{ background: "rgba(63, 182, 143, 0.14)", borderColor: "rgba(63, 182, 143, 0.35)", color: "#5fce9e" }}>
            Password updated. Sign in with your new password.
          </div>
        )}

        <form action={login}>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={styles.input}
            />
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
      </div>
    </div>
  );
}
