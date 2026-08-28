import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMfaStatus, hasPasswordSet } from "@/lib/mfa";
import { verifyStepUpAction } from "@/lib/mfa-actions";
import { Banner, Button, Card, Field, Input } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credential: "That didn't match. Try again.",
  action_failed: "Something went wrong. Try again.",
};

/** Only a same-portal relative path is ever honored — see mfa-actions.ts's sanitizeReturnTo. */
function safeReturnTo(raw: string | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")) return raw;
  return "/dashboard";
}

/**
 * "Prove it's still you" — reached whenever a sensitive action's lib
 * function throws mfa.ts's StepUpRequiredError (see docs/
 * MFA_ACCOUNT_SECURITY.md for the full list of actions that do). One
 * shared component, rendered at each portal's `/step-up`, mirroring
 * SecurityPanel/MfaChallenge's sharing convention. Offers whichever
 * factors the account actually has: the account password (if set — a
 * Google-only account has none), a live TOTP code, or a recovery code
 * (both only if MFA is enabled). verifyStepUpAction() re-checks the
 * chosen factor server-side regardless of which button was clicked.
 */
export async function StepUpChallenge({
  searchParams,
}: {
  searchParams: { returnTo?: string; error?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const [mfaStatus, hasPassword] = await Promise.all([getMfaStatus(actor), hasPasswordSet(actor)]);
  const returnTo = safeReturnTo(searchParams.returnTo);

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: 420 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Confirm it's you</h1>
        <p className={ui.mono} style={{ fontSize: 13 }}>
          This action needs a fresh security check before it can continue.
        </p>
      </div>

      {searchParams.error && <Banner>{ERROR_MESSAGES[searchParams.error] ?? "Something went wrong."}</Banner>}

      {mfaStatus.enabled && (
        <Card style={{ padding: "20px", display: "grid", gap: "10px" }}>
          <div style={{ fontWeight: 700 }}>Authenticator app</div>
          <form action={verifyStepUpAction} style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="method" value="totp" />
            <Field label="6-digit code">
              <Input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus />
            </Field>
            <Button type="submit" variant="primary">
              Verify
            </Button>
          </form>
        </Card>
      )}

      {hasPassword && (
        <Card style={{ padding: "20px", display: "grid", gap: "10px" }}>
          <div style={{ fontWeight: 700 }}>Account password</div>
          <form action={verifyStepUpAction} style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="method" value="password" />
            <Field label="Password">
              <Input name="password" type="password" required autoFocus={!mfaStatus.enabled} />
            </Field>
            <Button type="submit" variant="secondary">
              Verify
            </Button>
          </form>
        </Card>
      )}

      {mfaStatus.enabled && (
        <Card style={{ padding: "20px", display: "grid", gap: "10px" }}>
          <div style={{ fontWeight: 700 }}>Recovery code</div>
          <form action={verifyStepUpAction} style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="method" value="recovery_code" />
            <Field label="Recovery code">
              <Input name="code" placeholder="XXXX-XXXX-XXXX" required />
            </Field>
            <Button type="submit" variant="outline">
              Verify
            </Button>
          </form>
        </Card>
      )}

      {!mfaStatus.enabled && !hasPassword && (
        <Banner>
          No verification method is available for this account. Contact an administrator.
        </Banner>
      )}
    </div>
  );
}
