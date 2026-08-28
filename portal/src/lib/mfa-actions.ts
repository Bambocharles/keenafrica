"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import {
  MfaError,
  StepUpRequiredError,
  beginTotpEnrollment,
  completeLoginMfa,
  confirmTotpEnrollment,
  disableMfa,
  regenerateRecoveryCodes,
  verifyStepUp,
  type StepUpCredential,
} from "@/lib/mfa";
import { changeOwnEmail, changeOwnPassword } from "@/lib/users";
import { markSessionSteppedUp, revokeAllUserSessions, revokeSession } from "@/lib/sessions";
import { recordAuditEvent } from "@/lib/audit";
import { ENROLL_COOKIE, RECOVERY_COOKIE } from "@/lib/mfa-cookie-names";

/**
 * Shared Server Actions for every portal's `/mfa` (login-time challenge),
 * `/security` (self-service enrollment/disable/recovery codes/sessions),
 * and `/step-up` (sensitive-action re-verification) pages — one module,
 * reused across admin/teacher/student/sponsor the same way
 * onboarding-actions.ts is shared across teacher/student. Each page passes
 * its own `returnTo` so the SAME action can land a caller back wherever it
 * was invoked from.
 */

const SHORT_COOKIE_TTL_S = 300; // 5 minutes — long enough to scan a QR/copy codes, short enough to limit exposure if abandoned.

function cookieOpts(maxAge = SHORT_COOKIE_TTL_S) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge,
    path: "/",
  };
}

async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user;
}

/** Only ever a same-portal relative path — never follows an absolute URL or a protocol-relative "//" one. */
function sanitizeReturnTo(raw: FormDataEntryValue | null, fallback: string): string {
  const value = typeof raw === "string" ? raw : "";
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("://")) {
    return value;
  }
  return fallback;
}

function toStepUpRedirect(returnTo: string): string {
  return `/step-up?returnTo=${encodeURIComponent(returnTo)}`;
}

// --- Self-service enrollment (Security page) --------------------------------

export async function beginEnrollmentAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");

  let needsStepUp = false;
  let cookiePayload: string | null = null;
  try {
    const { secretBase32, otpauthUri } = await beginTotpEnrollment(actor, actor.email ?? actor.id);
    cookiePayload = JSON.stringify({ secret: secretBase32, uri: otpauthUri });
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      needsStepUp = true;
    } else {
      throw err;
    }
  }

  if (needsStepUp) {
    redirect(toStepUpRedirect(`${returnTo}?enroll=1`));
  }
  const store = await cookies();
  store.set(ENROLL_COOKIE, cookiePayload!, cookieOpts());
  redirect(`${returnTo}?enroll=1`);
}

/**
 * Confirms enrollment. Distinguishes the LOGIN-time path (the session is
 * still mfaPending — completing enrollment here doubles as this session's
 * MFA verification, see mfa.ts's completeLoginMfa docstring) from the
 * self-service path (already fully authenticated; enrolling doesn't touch
 * login state at all).
 */
export async function confirmEnrollmentAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");
  const code = String(formData.get("code") ?? "");

  let error: string | null = null;
  let recoveryCodes: string[] | null = null;
  try {
    const result = await confirmTotpEnrollment(actor, code);
    recoveryCodes = result.recoveryCodes;

    if (actor.mfaPending && actor.sessionId) {
      // Freshly confirming an authenticator app IS the strongest possible
      // proof of the second factor — satisfy this login's pending MFA gate
      // in the same step, rather than making someone immediately re-enter
      // the code they just typed a second time.
      await markSessionSteppedUp(actor.sessionId, actor.id, { alsoMfaVerified: true });
      await recordAuditEvent({
        actorId: actor.id,
        action: "mfa.login_verified",
        entityType: "User",
        entityId: actor.id,
        metadata: { method: "fresh_enrollment", sessionId: actor.sessionId },
      });
    }
  } catch (err) {
    error = err instanceof MfaError ? "invalid_code" : "action_failed";
  }

  const store = await cookies();
  store.delete(ENROLL_COOKIE);

  if (error) {
    redirect(`${returnTo}?enroll=1&error=${error}`);
  }

  store.set(RECOVERY_COOKIE, JSON.stringify(recoveryCodes), cookieOpts());
  redirect(`${returnTo}?codes=1`);
}

export async function disableMfaAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");

  let error: string | null = null;
  try {
    await disableMfa(actor);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      redirect(toStepUpRedirect(returnTo));
    }
    error = "action_failed";
  }

  redirect(error ? `${returnTo}?error=${error}` : `${returnTo}?disabled=1`);
}

export async function regenerateRecoveryCodesAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");

  let error: string | null = null;
  let codes: string[] | null = null;
  try {
    codes = await regenerateRecoveryCodes(actor);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      redirect(toStepUpRedirect(returnTo));
    }
    error = "action_failed";
  }

  if (error) {
    redirect(`${returnTo}?error=${error}`);
  }
  const store = await cookies();
  store.set(RECOVERY_COOKIE, JSON.stringify(codes), cookieOpts());
  redirect(`${returnTo}?codes=1`);
}

// --- Login-time MFA challenge (/mfa) ----------------------------------------

export async function verifyLoginMfaAction(formData: FormData) {
  const actor = await requireActor();
  if (!actor.sessionId) throw new Error("No active session");

  const code = String(formData.get("code") ?? "").trim();
  const recoveryCode = String(formData.get("recoveryCode") ?? "").trim();

  let error: string | null = null;
  try {
    await completeLoginMfa({
      sessionId: actor.sessionId,
      userId: actor.id,
      code: code || undefined,
      recoveryCode: recoveryCode || undefined,
    });
  } catch (err) {
    error = err instanceof MfaError ? "invalid_code" : "action_failed";
  }

  redirect(error ? `/mfa?error=${error}` : "/dashboard");
}

/** Abandons a pending login (e.g. "not you" / lost access) — signs out entirely rather than leaving a half-authenticated session sitting around. */
export async function cancelLoginMfaAction() {
  await signOut({ redirectTo: "/login" });
}

// --- Step-up challenge (/step-up) -------------------------------------------

export async function verifyStepUpAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");
  const method = String(formData.get("method") ?? "password");

  let credential: StepUpCredential;
  if (method === "totp") {
    credential = { type: "totp", code: String(formData.get("code") ?? "") };
  } else if (method === "recovery_code") {
    credential = { type: "recovery_code", code: String(formData.get("code") ?? "") };
  } else {
    credential = { type: "password", password: String(formData.get("password") ?? "") };
  }

  let error: string | null = null;
  try {
    await verifyStepUp(actor, credential);
  } catch (err) {
    error = err instanceof StepUpRequiredError ? "invalid_credential" : "action_failed";
  }

  redirect(error ? `/step-up?returnTo=${encodeURIComponent(returnTo)}&error=${error}` : returnTo);
}

// --- Self-service change password / change email (Security page) ----------
//
// Both require step-up regardless of what the form shows — see
// docs/MFA_ACCOUNT_SECURITY.md. Distinct from Session 02's admin-triggered
// requestPasswordReset()/resetPassword() (token-based, no active session —
// unaffected by this session) and from src/lib/oauth-identity.ts's
// "Connect Google" (unaffected — that flow doesn't touch password/email).

export async function changePasswordAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    redirect(`${returnTo}?error=password_mismatch`);
  }

  let error: string | null = null;
  try {
    await changeOwnPassword(actor, newPassword);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      redirect(toStepUpRedirect(returnTo));
    }
    if (err instanceof AuthorizationError) {
      error = "not_authorized";
    } else if (err instanceof Error && err.message === "weak_password") {
      error = "weak_password";
    } else {
      error = "action_failed";
    }
  }

  redirect(error ? `${returnTo}?error=${error}` : `${returnTo}?passwordChanged=1`);
}

export async function changeEmailAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");
  const newEmail = String(formData.get("newEmail") ?? "").trim();

  let error: string | null = null;
  try {
    await changeOwnEmail(actor, newEmail);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      redirect(toStepUpRedirect(returnTo));
    }
    if (err instanceof AuthorizationError) {
      error = "not_authorized";
    } else if (err instanceof Error && err.message === "email_taken") {
      error = "email_taken";
    } else {
      error = "action_failed";
    }
  }

  redirect(error ? `${returnTo}?error=${error}` : `${returnTo}?emailChanged=1`);
}

// --- Device/session list (Security page) ------------------------------------
//
// Reuses Session 02's sessions.ts revokeSession()/revokeAllUserSessions()
// exactly as-is (both already permit "self, super_admin, or
// sessions.revoke" — see requireOwnResourceOrPermission) — no new
// session/device model, per this session's explicit "Must NOT."

export async function revokeOwnSessionAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");
  const sessionId = String(formData.get("sessionId") ?? "");

  let error: string | null = null;
  try {
    await revokeSession(sessionId, actor);
  } catch {
    error = "action_failed";
  }

  redirect(error ? `${returnTo}?error=${error}` : returnTo);
}

export async function revokeAllOwnSessionsAction(formData: FormData) {
  const actor = await requireActor();
  const returnTo = sanitizeReturnTo(formData.get("returnTo"), "/security");

  let error: string | null = null;
  try {
    await revokeAllUserSessions(actor.id, actor);
  } catch {
    error = "action_failed";
  }

  redirect(error ? `${returnTo}?error=${error}` : returnTo);
}
