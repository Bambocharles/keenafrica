import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import styles from "./login.module.css";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.isSuperAdmin) {
    // Relative to this subdomain - middleware prepends "/admin" on the
    // fresh request this redirect triggers. An absolute "/admin/..." path
    // here would get double-prefixed into a route that doesn't exist.
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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.mark}>K</div>
        <h1 className={styles.title}>Keen Africa Admin</h1>
        <p className={styles.subtitle}>Sign in to manage sponsors and projects</p>

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
