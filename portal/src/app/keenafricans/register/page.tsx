import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { registerUser } from "@/lib/registration";
import { requestEmailVerification } from "@/lib/email-verification";
import { COUNTRIES, ensureProfile } from "@/lib/profiles";
import styles from "../login/login.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "Enter a valid name and email address.",
  weak_password: "Password must be at least 8 characters.",
  password_mismatch: "Passwords don't match.",
  missing_country: "Select your country.",
  email_taken: "An account already exists for that email — try logging in instead.",
  signin_failed: "Account created, but automatic sign-in failed. Please log in.",
};

/**
 * Open self-registration — anyone who registers here immediately becomes a
 * Keen African (KEEN_AFRICAN role), same mechanism as
 * teacher.<root>/register and student.<root>/register (Session 18), just a
 * third REGISTERABLE_ROLES value (see src/lib/registration.ts). No
 * approval gate: this is the trust-model difference sessions/34-keen-
 * africans.md calls out explicitly — the account can sign in and draft
 * immediately, but src/lib/articles.ts's publishArticle() will refuse a
 * first publish until the verification email below is confirmed.
 */
export default async function KeenAfricansRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (canAccessKeenAfricanPortal(session?.user)) {
    redirect("/dashboard");
  }
  const { error } = await searchParams;

  async function register(formData: FormData) {
    "use server";
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const name = `${firstName} ${lastName}`.trim();
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const country = String(formData.get("country") ?? "").trim();

    if (password !== confirm) {
      redirect(`/register?error=password_mismatch`);
    }
    if (!country) {
      redirect(`/register?error=missing_country`);
    }

    const outcome = await registerUser({ name, email, password, role: "KEEN_AFRICAN" });
    if (!outcome.ok) {
      redirect(`/register?error=${outcome.error}`);
    }

    await requestEmailVerification(outcome.userId, outcome.email, outcome.name);
    // Keep registration minimal (name/email/password/country) — everything
    // else (avatar, bio, profession, interests, social links) is filled in
    // after registration via the "complete your profile" flow (/profile).
    // Bare-userId RLS context, no session yet — same convention
    // src/lib/email-verification.ts's requestEmailVerification() already
    // uses for this exact pre-signIn bootstrap situation.
    await ensureProfile({ id: outcome.userId, isSuperAdmin: false, permissions: [] }, { name: outcome.name, country });

    try {
      await signIn("credentials", { email, password, redirectTo: "/dashboard" });
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
        <h1 className={styles.title}>Become a Keen African</h1>
        <p className={styles.subtitle}>Write and publish your own articles on Keen Africa</p>

        {error && (
          <div className={styles.error} role="alert">
            {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
          </div>
        )}

        <form action={register}>
          <div className={styles.field}>
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" type="text" autoComplete="given-name" required className={styles.input} />
          </div>
          <div className={styles.field}>
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" type="text" autoComplete="family-name" required className={styles.input} />
          </div>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className={styles.input} />
          </div>
          <div className={styles.field}>
            <label htmlFor="country">Country</label>
            <select id="country" name="country" required className={styles.input} defaultValue="">
              <option value="" disabled>
                Select a country
              </option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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

        <p className={styles.subtitle} style={{ marginTop: "14px", marginBottom: 0 }}>
          By creating an account you agree to our <a href="/terms">Terms of Service</a> and{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <p className={styles.subtitle} style={{ marginTop: "10px", marginBottom: 0 }}>
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
    </div>
  );
}
