import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { canAccessSponsorPortal } from "@/lib/authz";
import styles from "./login.module.css";

export default async function SponsorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (canAccessSponsorPortal(session?.user)) {
    // Relative to this subdomain - middleware prepends "/sponsor" on the
    // fresh request this redirect triggers (mirrors the teacher/admin login
    // pages).
    redirect("/dashboard");
  }
  const { error } = await searchParams;

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
      // only a genuine AuthError is an actual login failure (see the admin
      // login page, which hit this same footgun first).
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
        <h1 className={styles.title}>Keen Africa Sponsor</h1>
        <p className={styles.subtitle}>Sign in to view your sponsored projects</p>

        {error && (
          <div className={styles.error} role="alert">
            Invalid email or password. Check both and try again.
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
      </div>
    </div>
  );
}
