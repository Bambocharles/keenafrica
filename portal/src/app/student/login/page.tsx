import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { canAccessStudentPortal } from "@/lib/authz";
import styles from "./login.module.css";

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const session = await auth();
  if (canAccessStudentPortal(session?.user)) {
    // Relative to this subdomain — middleware prepends "/student" on the
    // fresh request this redirect triggers (see src/middleware.ts and the
    // matching comment on the admin login page).
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
      // signIn() throws Next.js's internal redirect signal on SUCCESS too —
      // only AuthError is a real auth failure (see the admin login page's
      // identical comment for why this can't be a blanket catch).
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>K</div>
        <h1 className={styles.title}>Keen Africa Student</h1>
        <p className={styles.subtitle}>Sign in to continue learning</p>

        {error && (
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

        <p className={styles.subtitle} style={{ marginTop: "16px", marginBottom: 0 }}>
          New here? <a href="/register">Create an account</a>
        </p>
      </div>
    </div>
  );
}
