import { compare } from "bcryptjs";
import QRCode from "qrcode";
import { withRls } from "@/lib/rls";
import { type AuthzActor, type RoleName } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { isStepUpFresh, markSessionSteppedUp, STEP_UP_WINDOW_MS } from "@/lib/sessions";
import { isMfaAttemptRateLimited } from "@/lib/rate-limit";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  generateTotpSecretBase32,
  hashRecoveryCode,
  totpAuthUri,
  verifyTotpCode,
} from "@/lib/mfa-crypto";

/**
 * MFA & Account Security (Session 20).
 *
 * Owns: TOTP enrollment/confirmation/disable, recovery codes, the
 * login-time MFA gate (paired with sessions.ts's mfaRequired/mfaVerifiedAt
 * columns and resolveSessionAuthz()'s zeroing behavior), the role/policy
 * hook for "this account must have MFA," and step-up authentication for
 * sensitive actions. See docs/MFA_ACCOUNT_SECURITY.md for the full
 * contract and the list of actions this session wired step-up into.
 *
 * Deliberately does NOT import src/lib/sessions.ts's createSession/
 * resolveSessionAuthz/revokeSession — those stay exactly as Session 02
 * built them. This module only reads/writes the Session row's own
 * mfa_required/mfa_verified_at/step_up_verified_at columns, through the two
 * narrow helpers sessions.ts exports for that (isStepUpFresh/
 * markSessionSteppedUp) — no second session/device model.
 */

const RECOVERY_CODE_COUNT = 10;

export class StepUpRequiredError extends Error {
  constructor(message = "Step-up authentication required") {
    super(message);
    this.name = "StepUpRequiredError";
  }
}

export class MfaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaError";
  }
}

// --- Policy hook -------------------------------------------------------
//
// "This role requires MFA" (sessions/20-mfa-account-security.md — SUPER_ADMIN
// is the explicit example). A plain, easily-extended code list rather than
// a new table: adding an organization-level policy later is a matter of
// widening policyRequiresMfa()'s inputs, not a schema change, and this is
// re-evaluated fresh on every login (never cached), so tightening it takes
// effect for a role's very next login, same immediacy as every other
// server-side authz check in this app.

export const MFA_REQUIRED_ROLES: readonly RoleName[] = ["SUPER_ADMIN"];

export function policyRequiresMfa(roles: readonly string[]): boolean {
  return roles.some((r) => (MFA_REQUIRED_ROLES as readonly string[]).includes(r));
}

async function hasEnabledTotp(userId: string): Promise<boolean> {
  const credential = await withRls({ userId }, (tx) =>
    tx.totpCredential.findUnique({ where: { userId }, select: { enabledAt: true } })
  );
  return Boolean(credential?.enabledAt);
}

/**
 * Called by auth.ts's authorize()/signIn callback BEFORE createSession() —
 * the result becomes that call's `mfaRequired` input. True if the account
 * already has TOTP enabled (must re-verify every login), OR the account
 * holds a role the policy above covers (must enroll-or-verify before it can
 * do anything — see resolveSessionAuthz()'s zeroing behavior).
 */
export async function shouldRequireLoginMfa(userId: string): Promise<boolean> {
  const [totpEnabled, userRoles] = await Promise.all([
    hasEnabledTotp(userId),
    withRls({ userId }, (tx) =>
      tx.userRole.findMany({ where: { userId }, select: { role: { select: { name: true } } } })
    ),
  ]);
  return totpEnabled || policyRequiresMfa(userRoles.map((ur) => ur.role.name));
}

// --- Enrollment ----------------------------------------------------------

export interface MfaStatus {
  enabled: boolean;
  /** True while a secret has been generated but not yet confirmed with a code. */
  pendingEnrollment: boolean;
  recoveryCodesRemaining: number;
}

/** For the step-up challenge UI — a Google-only account (schema.prisma's User.passwordHash comment) has no password factor to offer. */
export async function hasPasswordSet(actor: AuthzActor): Promise<boolean> {
  const user = await withRls({ userId: actor.id }, (tx) =>
    tx.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } })
  );
  return Boolean(user?.passwordHash);
}

export async function getMfaStatus(actor: AuthzActor): Promise<MfaStatus> {
  const [credential, remaining] = await withRls({ userId: actor.id }, (tx) =>
    Promise.all([
      tx.totpCredential.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } }),
      tx.recoveryCode.count({ where: { userId: actor.id, usedAt: null } }),
    ])
  );
  return {
    enabled: Boolean(credential?.enabledAt),
    pendingEnrollment: Boolean(credential && !credential.enabledAt),
    recoveryCodesRemaining: credential?.enabledAt ? remaining : 0,
  };
}

export interface BeginEnrollmentResult {
  secretBase32: string;
  otpauthUri: string;
  qrSvg: string;
}

/**
 * Generates a fresh secret and stores it (encrypted, unconfirmed). Starting
 * enrollment when nothing is enabled yet needs no step-up — there is
 * nothing to protect. REPLACING an already-enabled credential (the
 * documented lost-device/new-authenticator path) requires a fresh step-up
 * proof first: this is itself a security-relevant change, never a plain
 * "generate a new secret" toggle.
 */
export async function beginTotpEnrollment(actor: AuthzActor, accountEmail: string): Promise<BeginEnrollmentResult> {
  const existing = await withRls({ userId: actor.id }, (tx) =>
    tx.totpCredential.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } })
  );
  if (existing?.enabledAt) {
    await requireStepUp(actor);
  }

  const secretBase32 = generateTotpSecretBase32();
  const secretCiphertext = encryptTotpSecret(secretBase32);

  await withRls({ userId: actor.id }, (tx) =>
    tx.totpCredential.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, secretCiphertext },
      // Re-running enrollment before confirming replaces the pending secret;
      // an already-ENABLED credential only reaches this point after the
      // requireStepUp() above, and confirmTotpEnrollment() is what actually
      // flips enabledAt back to null-then-set — see there.
      update: { secretCiphertext, enabledAt: null },
    })
  );

  const otpauthUri = totpAuthUri({ secretBase32, accountLabel: accountEmail, issuer: "Keen Africa" });
  const qrSvg = await renderTotpQrSvg(otpauthUri);

  return { secretBase32, otpauthUri, qrSvg };
}

/** Re-renders the QR for an already-generated otpauth URI (e.g. from the short-lived enrollment cookie) without touching the DB again. */
export async function renderTotpQrSvg(otpauthUri: string): Promise<string> {
  return QRCode.toString(otpauthUri, { type: "svg", margin: 1, width: 220 });
}

export interface ConfirmEnrollmentResult {
  recoveryCodes: string[];
}

/**
 * Confirms the pending secret with a real code from the authenticator app,
 * flips enabledAt, and issues a brand-new batch of recovery codes (any
 * prior batch — from a previous enrollment — is invalidated in the same
 * transaction). The plaintext codes are returned exactly once; only their
 * hashes are ever persisted.
 */
export async function confirmTotpEnrollment(actor: AuthzActor, code: string): Promise<ConfirmEnrollmentResult> {
  if (await isMfaAttemptRateLimited(actor.id)) {
    throw new MfaError("Too many attempts. Try again later.");
  }

  const credential = await withRls({ userId: actor.id }, (tx) =>
    tx.totpCredential.findUnique({ where: { userId: actor.id }, select: { secretCiphertext: true } })
  );
  if (!credential) {
    throw new MfaError("No enrollment in progress");
  }

  const secretBase32 = decryptTotpSecret(credential.secretCiphertext);
  if (!verifyTotpCode(secretBase32, code)) {
    await recordAuditEvent({
      actorId: actor.id,
      action: "mfa.enrollment_failed",
      entityType: "User",
      entityId: actor.id,
    });
    throw new MfaError("Invalid code");
  }

  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

  await withRls({ userId: actor.id }, async (tx) => {
    await tx.totpCredential.update({ where: { userId: actor.id }, data: { enabledAt: new Date() } });
    await tx.recoveryCode.deleteMany({ where: { userId: actor.id } });
    await tx.recoveryCode.createMany({
      data: rawCodes.map((c) => ({ userId: actor.id, codeHash: hashRecoveryCode(c) })),
    });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "mfa.enabled",
    entityType: "User",
    entityId: actor.id,
  });

  return { recoveryCodes: rawCodes };
}

/**
 * Disabling MFA is itself a sensitive action — never a plain toggle. Always
 * requires a fresh step-up proof (the current TOTP code, a recovery code,
 * or the account password), enforced here regardless of what the calling
 * UI shows.
 */
export async function disableMfa(actor: AuthzActor): Promise<void> {
  await requireStepUp(actor);

  const existing = await withRls({ userId: actor.id }, (tx) =>
    tx.totpCredential.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } })
  );
  if (!existing?.enabledAt) {
    throw new MfaError("MFA is not enabled");
  }

  await withRls({ userId: actor.id }, async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId: actor.id } });
    await tx.totpCredential.delete({ where: { userId: actor.id } });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "mfa.disabled",
    entityType: "User",
    entityId: actor.id,
  });
}

/** Invalidates every existing recovery code and issues a fresh batch. Requires step-up — same tier as disableMfa(). */
export async function regenerateRecoveryCodes(actor: AuthzActor): Promise<string[]> {
  await requireStepUp(actor);

  const existing = await withRls({ userId: actor.id }, (tx) =>
    tx.totpCredential.findUnique({ where: { userId: actor.id }, select: { enabledAt: true } })
  );
  if (!existing?.enabledAt) {
    throw new MfaError("MFA is not enabled");
  }

  const rawCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

  await withRls({ userId: actor.id }, async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId: actor.id } });
    await tx.recoveryCode.createMany({
      data: rawCodes.map((c) => ({ userId: actor.id, codeHash: hashRecoveryCode(c) })),
    });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "mfa.recovery_codes_regenerated",
    entityType: "User",
    entityId: actor.id,
  });

  return rawCodes;
}

// --- Login-time verification ----------------------------------------------

export interface CompleteLoginMfaInput {
  sessionId: string;
  userId: string;
  code?: string;
  recoveryCode?: string;
}

/**
 * Called from the `/mfa` challenge page (one per portal) for a session
 * whose resolveSessionAuthz() snapshot came back mfaPending. Verifies
 * either a live TOTP code or a recovery code (never both in one call),
 * then marks the session stepped-up AND mfa-verified in the same write —
 * a fresh factor proof at login satisfies both.
 */
export async function completeLoginMfa(input: CompleteLoginMfaInput): Promise<void> {
  if (await isMfaAttemptRateLimited(input.userId)) {
    throw new MfaError("Too many attempts. Try again later.");
  }

  const verified = input.recoveryCode
    ? await consumeRecoveryCode(input.userId, input.recoveryCode)
    : await verifyTotpForUser(input.userId, input.code ?? "");

  if (!verified) {
    await recordAuditEvent({
      actorId: input.userId,
      action: "mfa.login_failed",
      entityType: "User",
      entityId: input.userId,
      metadata: { method: input.recoveryCode ? "recovery_code" : "totp" },
    });
    throw new MfaError("Invalid code");
  }

  await markSessionSteppedUp(input.sessionId, input.userId, { alsoMfaVerified: true });

  await recordAuditEvent({
    actorId: input.userId,
    action: "mfa.login_verified",
    entityType: "User",
    entityId: input.userId,
    metadata: { method: input.recoveryCode ? "recovery_code" : "totp", sessionId: input.sessionId },
  });
}

async function verifyTotpForUser(userId: string, code: string): Promise<boolean> {
  if (!code) return false;
  const credential = await withRls({ userId, mfaLoginLookup: true }, (tx) =>
    tx.totpCredential.findUnique({ where: { userId }, select: { secretCiphertext: true, enabledAt: true } })
  );
  if (!credential?.enabledAt) return false;
  return verifyTotpCode(decryptTotpSecret(credential.secretCiphertext), code);
}

/** Single-use — marks the code used in the same query that validates it, via a conditional UPDATE. */
async function consumeRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
  const codeHash = hashRecoveryCode(rawCode);
  const result = await withRls({ userId, mfaLoginLookup: true }, (tx) =>
    tx.recoveryCode.updateMany({
      where: { userId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    })
  );
  const consumed = result.count === 1;
  if (consumed) {
    await recordAuditEvent({
      actorId: userId,
      action: "mfa.recovery_code_used",
      entityType: "User",
      entityId: userId,
    });
  }
  return consumed;
}

// --- Step-up authentication ------------------------------------------------

/**
 * Throws StepUpRequiredError unless this session proved its current factor
 * within STEP_UP_WINDOW_MS. Call this at the top of every sensitive
 * action's lib function (never only in the UI) — see
 * docs/MFA_ACCOUNT_SECURITY.md for the full list this session wired it
 * into.
 */
export async function requireStepUp(actor: AuthzActor): Promise<void> {
  if (!actor.sessionId) {
    throw new StepUpRequiredError();
  }
  const fresh = await isStepUpFresh(actor.sessionId, actor.id);
  if (!fresh) {
    throw new StepUpRequiredError();
  }
}

export type StepUpCredential =
  | { type: "password"; password: string }
  | { type: "totp"; code: string }
  | { type: "recovery_code"; code: string };

/**
 * Re-verifies ONE current factor and, on success, refreshes this session's
 * step-up freshness window. The password branch is available to any
 * account with a password set (see schema.prisma's User.passwordHash
 * comment — a Google-only account has none, so that branch always fails
 * closed for one); the totp/recovery_code branches require MFA to be
 * enabled. Rate-limited the same way login-time MFA verification is.
 */
export async function verifyStepUp(actor: AuthzActor, credential: StepUpCredential): Promise<void> {
  if (!actor.sessionId) {
    throw new StepUpRequiredError();
  }
  if (await isMfaAttemptRateLimited(actor.id)) {
    throw new MfaError("Too many attempts. Try again later.");
  }

  let ok = false;
  if (credential.type === "password") {
    const user = await withRls({ userId: actor.id }, (tx) =>
      tx.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } })
    );
    ok = user?.passwordHash ? await compare(credential.password, user.passwordHash) : false;
  } else if (credential.type === "totp") {
    ok = await verifyTotpForUser(actor.id, credential.code);
  } else {
    ok = await consumeRecoveryCode(actor.id, credential.code);
  }

  if (!ok) {
    await recordAuditEvent({
      actorId: actor.id,
      action: "step_up.failed",
      entityType: "User",
      entityId: actor.id,
      metadata: { method: credential.type },
    });
    throw new StepUpRequiredError("Verification failed");
  }

  await markSessionSteppedUp(actor.sessionId, actor.id);

  await recordAuditEvent({
    actorId: actor.id,
    action: "step_up.verified",
    entityType: "User",
    entityId: actor.id,
    metadata: { method: credential.type },
  });
}

export { STEP_UP_WINDOW_MS };
