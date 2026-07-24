import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.isSuperAdmin) {
    redirect("/admin/dashboard");
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
        redirectTo: "/admin/dashboard",
      });
    } catch (err) {
      // next-auth throws a redirect internally on success; only a real
      // auth failure reaches here.
      redirect("/admin/login?error=1");
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
