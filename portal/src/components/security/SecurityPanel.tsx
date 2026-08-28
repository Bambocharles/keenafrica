import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMfaStatus, renderTotpQrSvg } from "@/lib/mfa";
import { listSessions } from "@/lib/sessions";
import {
  beginEnrollmentAction,
  changeEmailAction,
  changePasswordAction,
  confirmEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
  revokeAllOwnSessionsAction,
  revokeOwnSessionAction,
} from "@/lib/mfa-actions";
import { ENROLL_COOKIE, RECOVERY_COOKIE } from "@/lib/mfa-cookie-names";
import { Banner, Button, Card, Field, Input, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That code didn't match. Check your authenticator app and try again.",
  action_failed: "That action could not be completed.",
  not_authorized: "You do not have permission to do that.",
  weak_password: "Password must be at least 8 characters.",
  password_mismatch: "Passwords do not match.",
  email_taken: "That email address is already in use.",
  invalid_input: "That doesn't look like a valid email address.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const RETURN_TO = "/security";

/**
 * Self-service account security — one shared component reused across
 * admin/teacher/student/sponsor (same convention as
 * components/organization/OrganizationManage.tsx), rendered at each
 * portal's `/security`. Covers this session's Owns list: TOTP enrollment/
 * disable, recovery codes, device/session list (Session 02's
 * listSessions/revokeSession, not a new model), and self-service change
 * password/email — every mutation here either goes through mfa.ts's
 * requireStepUp() itself or (sessions/password/email) through a lib
 * function that does.
 */
export async function SecurityPanel({
  searchParams,
}: {
  searchParams: {
    enroll?: string;
    codes?: string;
    error?: string;
    disabled?: string;
    passwordChanged?: string;
    emailChanged?: string;
  };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const [mfaStatus, sessionRows, store] = await Promise.all([getMfaStatus(actor), listSessions(actor.id, actor), cookies()]);

  let pendingEnrollment: { secret: string; uri: string; qrSvg: string } | null = null;
  if (searchParams.enroll === "1") {
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

  let revealedRecoveryCodes: string[] | null = null;
  if (searchParams.codes === "1") {
    const raw = store.get(RECOVERY_COOKIE)?.value;
    if (raw) {
      try {
        revealedRecoveryCodes = JSON.parse(raw) as string[];
      } catch {
        revealedRecoveryCodes = null;
      }
    }
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="Account security" count={0} />

      {searchParams.error && (
        <Banner>{ERROR_MESSAGES[searchParams.error] ?? "Something went wrong."}</Banner>
      )}
      {searchParams.disabled === "1" && <Banner variant="success">Two-factor authentication disabled.</Banner>}
      {searchParams.passwordChanged === "1" && <Banner variant="success">Password changed. Other devices have been signed out.</Banner>}
      {searchParams.emailChanged === "1" && <Banner variant="success">Email address updated.</Banner>}

      {revealedRecoveryCodes ? (
        <Card style={{ padding: "20px", display: "grid", gap: "12px", maxWidth: 480 }}>
          <div style={{ fontWeight: 700 }}>Save your recovery codes</div>
          <p className={ui.mono} style={{ fontSize: 13 }}>
            Each code works once. Store them somewhere safe — they're the only way back into your account if you lose
            your authenticator app. They will not be shown again.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontFamily: "monospace", fontSize: 14 }}>
            {revealedRecoveryCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          <div>
            <a href={RETURN_TO}>
              <Button type="button" variant="primary">
                I've saved these — continue
              </Button>
            </a>
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ padding: "20px", display: "grid", gap: "14px", maxWidth: 480 }}>
            <div style={{ fontWeight: 700 }}>Two-factor authentication (TOTP)</div>
            {mfaStatus.enabled ? (
              <>
                <p className={ui.mono} style={{ fontSize: 13 }}>
                  Enabled. {mfaStatus.recoveryCodesRemaining} recovery code
                  {mfaStatus.recoveryCodesRemaining === 1 ? "" : "s"} remaining.
                </p>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <form action={regenerateRecoveryCodesAction}>
                    <input type="hidden" name="returnTo" value={RETURN_TO} />
                    <Button type="submit" variant="secondary">
                      Regenerate recovery codes
                    </Button>
                  </form>
                  <form action={beginEnrollmentAction}>
                    <input type="hidden" name="returnTo" value={RETURN_TO} />
                    <Button type="submit" variant="outline">
                      Replace authenticator
                    </Button>
                  </form>
                  <form action={disableMfaAction}>
                    <input type="hidden" name="returnTo" value={RETURN_TO} />
                    <Button type="submit" variant="danger">
                      Disable
                    </Button>
                  </form>
                </div>
              </>
            ) : pendingEnrollment ? (
              <>
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
              </>
            ) : (
              <>
                <p className={ui.mono} style={{ fontSize: 13 }}>
                  Not enabled. Add an authenticator app for a second sign-in factor.
                </p>
                <form action={beginEnrollmentAction}>
                  <input type="hidden" name="returnTo" value={RETURN_TO} />
                  <Button type="submit" variant="primary">
                    Set up two-factor authentication
                  </Button>
                </form>
              </>
            )}
          </Card>

          <Card style={{ padding: "20px", display: "grid", gap: "12px", maxWidth: 480 }}>
            <div style={{ fontWeight: 700 }}>Change password</div>
            <form action={changePasswordAction} style={{ display: "grid", gap: "10px" }}>
              <input type="hidden" name="returnTo" value={RETURN_TO} />
              <Field label="New password">
                <Input name="newPassword" type="password" minLength={8} required />
              </Field>
              <Field label="Confirm new password">
                <Input name="confirmPassword" type="password" minLength={8} required />
              </Field>
              <div>
                <Button type="submit" variant="primary">
                  Change password
                </Button>
              </div>
            </form>
          </Card>

          <Card style={{ padding: "20px", display: "grid", gap: "12px", maxWidth: 480 }}>
            <div style={{ fontWeight: 700 }}>Change email</div>
            <form action={changeEmailAction} style={{ display: "grid", gap: "10px" }}>
              <input type="hidden" name="returnTo" value={RETURN_TO} />
              <Field label="New email address">
                <Input name="newEmail" type="email" defaultValue={actor.email ?? ""} required />
              </Field>
              <div>
                <Button type="submit" variant="primary">
                  Change email
                </Button>
              </div>
            </form>
          </Card>
        </>
      )}

      <section>
        <SectionHeader
          title="Devices & sessions"
          count={sessionRows.length}
          action={
            sessionRows.some((s) => !s.revokedAt) && (
              <form action={revokeAllOwnSessionsAction}>
                <input type="hidden" name="returnTo" value={RETURN_TO} />
                <Button type="submit" variant="danger">
                  Sign out everywhere
                </Button>
              </form>
            )
          }
        />
        {sessionRows.length === 0 ? (
          <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>No session history.</Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Signed in</th>
                <th>Expires</th>
                <th>IP</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.map((s) => (
                <tr key={s.id}>
                  <td className={ui.mono}>{formatDateTime(s.createdAt)}</td>
                  <td className={ui.mono}>{formatDateTime(s.expiresAt)}</td>
                  <td className={ui.mono}>{s.ipAddress ?? "—"}</td>
                  <td>
                    {s.revokedAt ? <StatusBadge status="suspended" /> : <StatusBadge status="active" />}
                    {s.id === actor.sessionId && !s.revokedAt ? " (this device)" : ""}
                  </td>
                  <td>
                    {!s.revokedAt && (
                      <form action={revokeOwnSessionAction}>
                        <input type="hidden" name="returnTo" value={RETURN_TO} />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <Button type="submit" variant="outline">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
