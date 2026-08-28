import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMfaStatus, renderTotpQrSvg } from "@/lib/mfa";
import {
  beginEnrollmentAction,
  cancelLoginMfaAction,
  confirmEnrollmentAction,
  verifyLoginMfaAction,
} from "@/lib/mfa-actions";
import { ENROLL_COOKIE, RECOVERY_COOKIE } from "@/lib/mfa-cookie-names";
import { Banner, Button, Card, Field, Input } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That code didn't work. Check your authenticator app (or try a recovery code) and try again.",
  action_failed: "Something went wrong. Try again.",
};

const RETURN_TO = "/mfa";

/**
 * The login-time MFA gate — reached whenever resolveSessionAuthz()
 * (src/lib/sessions.ts) reports mfaPending: a real, valid, unrevoked
 * session whose second factor hasn't been proven yet, so
 * roles/permissions/isSuperAdmin are all zeroed until this page's actions
 * clear it. One shared component, rendered at each portal's top-level
 * `/mfa` route (outside the `(protected)` group — a pending session must
 * still be able to reach exactly this page).
 *
 * Two branches: an account that ALREADY has TOTP enabled must enter a code
 * (or a recovery code) every login. An account that's here only because
 * its ROLE requires MFA (src/lib/mfa.ts's policyRequiresMfa — e.g.
 * SUPER_ADMIN) but has never enrolled must enroll right now — there is no
 * other way past this page, which is what makes the policy an actual
 * requirement rather than a suggestion.
 */
export async function MfaChallenge({
  searchParams,
}: {
  searchParams: { enroll?: string; codes?: string; error?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const store = await cookies();

  // Recovery codes just issued by completing enrollment mid-login — show
  // them even though mfaPending is now false (this page is reachable
  // outside (protected) regardless of pending state).
  if (searchParams.codes === "1") {
    const raw = store.get(RECOVERY_COOKIE)?.value;
    let codes: string[] | null = null;
    if (raw) {
      try {
        codes = JSON.parse(raw) as string[];
      } catch {
        codes = null;
      }
    }
    if (codes) {
      return (
        <Card style={{ padding: "20px", display: "grid", gap: "12px", maxWidth: 480 }}>
          <div style={{ fontWeight: 700 }}>Save your recovery codes</div>
          <p className={ui.mono} style={{ fontSize: 13 }}>
            Each code works once. Store them somewhere safe — they're the only way back into your account if you lose
            your authenticator app. They will not be shown again.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontFamily: "monospace", fontSize: 14 }}>
            {codes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          <div>
            <a href="/dashboard">
              <Button type="button" variant="primary">
                I've saved these — continue
              </Button>
            </a>
          </div>
        </Card>
      );
    }
  }

  if (!actor.mfaPending) {
    redirect("/dashboard");
  }

  const mfaStatus = await getMfaStatus(actor);

  let pendingEnrollment: { secret: string; uri: string; qrSvg: string } | null = null;
  if (!mfaStatus.enabled) {
    const raw = store.get(ENROLL_COOKIE)?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { secret: string; uri: string };
        pendingEnrollment = { ...parsed, qrSvg: await renderTotpQrSvg(parsed.uri) };
      } catch {
        pendingEnrollment = null;
      }
    }
  }

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: 440 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {mfaStatus.enabled ? "Two-factor verification" : "Set up two-factor authentication"}
        </h1>
        <p className={ui.mono} style={{ fontSize: 13 }}>
          {mfaStatus.enabled
            ? "Enter the code from your authenticator app to finish signing in."
            : "Your account requires two-factor authentication. Set it up now to continue."}
        </p>
      </div>

      {searchParams.error && <Banner>{ERROR_MESSAGES[searchParams.error] ?? "Something went wrong."}</Banner>}

      {mfaStatus.enabled ? (
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <form action={verifyLoginMfaAction} style={{ display: "grid", gap: "10px" }}>
            <Field label="6-digit code">
              <Input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus />
            </Field>
            <Button type="submit" variant="primary">
              Verify
            </Button>
          </form>
          <details>
            <summary className={ui.mono} style={{ fontSize: 13, cursor: "pointer" }}>
              Lost your device? Use a recovery code
            </summary>
            <form action={verifyLoginMfaAction} style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
              <Field label="Recovery code">
                <Input name="recoveryCode" placeholder="XXXX-XXXX-XXXX" />
              </Field>
              <Button type="submit" variant="secondary">
                Verify with recovery code
              </Button>
            </form>
          </details>
        </Card>
      ) : pendingEnrollment ? (
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <p className={ui.mono} style={{ fontSize: 13 }}>
            Scan this with Google Authenticator, Microsoft Authenticator, Authy, or any TOTP app, then enter the
            6-digit code it shows.
          </p>
          <div dangerouslySetInnerHTML={{ __html: pendingEnrollment.qrSvg }} />
          <p className={ui.mono} style={{ fontSize: 12 }}>
            Can't scan? Enter this key manually: <strong>{pendingEnrollment.secret}</strong>
          </p>
          <form action={confirmEnrollmentAction} style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <input type="hidden" name="returnTo" value={RETURN_TO} />
            <Field label="6-digit code">
              <Input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus />
            </Field>
            <Button type="submit" variant="primary">
              Confirm
            </Button>
          </form>
        </Card>
      ) : (
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <form action={beginEnrollmentAction}>
            <input type="hidden" name="returnTo" value={RETURN_TO} />
            <Button type="submit" variant="primary">
              Start setup
            </Button>
          </form>
        </Card>
      )}

      <form action={cancelLoginMfaAction}>
        <Button type="submit" variant="ghost">
          Not you? Sign out
        </Button>
      </form>
    </div>
  );
}
