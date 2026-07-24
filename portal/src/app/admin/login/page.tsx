import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";

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
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Keen Africa Admin</h1>
      {error && <p style={{ color: "crimson" }}>Invalid email or password.</p>}
      <form action={login} style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Email
          <input name="email" type="email" required style={{ width: "100%" }} />
        </label>
        <label>
          Password
          <input name="password" type="password" required style={{ width: "100%" }} />
        </label>
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
