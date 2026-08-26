import crypto from "node:crypto";
import { hash } from "bcryptjs";
import { withRls } from "@/lib/rls";
import { recordAuditEvent } from "@/lib/audit";
import { revokeAllUserSessionsAsSystem } from "@/lib/sessions";

// 1 hour — short enough to limit the window a leaked reset link is useful,
// long enough that email delivery delay doesn't routinely expire it.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface RequestPasswordResetResult {
  /**
   * The raw, single-use token — present ONLY here, at generation time. It
   * is never persisted (only its SHA-256 hash is), so this is the one
   * place in the system it's ever recoverable. null when the address
   * doesn't match an active account.
   *
   * Delivering this to the user (email) is NOT implemented by this
   * function — see docs/IDENTITY_SECURITY.md "Known limitations": no
   * transactional email provider exists in this infra yet. The caller is
   * responsible for delivery; today that's a console-logged dev stub.
   */
  token: string | null;
}

/**
 * Always returns the same shape (a resolved promise, no thrown error) for
 * both "no such account" and "account exists" so a caller can render an
 * identical "if that address exists, we've sent a link" message and avoid
 * leaking account existence to an unauthenticated caller.
 */
export async function requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
  const user = await withRls({ authLookup: true }, (tx) =>
    tx.user.findUnique({ where: { email }, select: { id: true, status: true } })
  );

  if (!user || user.status === "suspended") {
    return { token: null };
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await withRls({ userId: user.id, passwordResetLookup: true }, (tx) =>
    tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } })
  );

  await recordAuditEvent({
    actorId: user.id,
    action: "password_reset.requested",
    entityType: "User",
    entityId: user.id,
  });

  return { token: rawToken };
}

export type ResetPasswordOutcome = "ok" | "invalid_or_expired";

/**
 * Validates the raw token (by its hash), and if valid: sets the new
 * password, marks the token used (single-use), and revokes every existing
 * session for the account — a password reset must not leave an
 * already-authenticated attacker's session alive.
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<ResetPasswordOutcome> {
  const tokenHash = hashToken(rawToken);

  const record = await withRls({ passwordResetLookup: true }, (tx) =>
    tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    })
  );

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    return "invalid_or_expired";
  }

  const passwordHash = await hash(newPassword, 12);

  await withRls({ userId: record.userId, passwordResetLookup: true }, async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  });

  await revokeAllUserSessionsAsSystem(record.userId, record.userId);

  await recordAuditEvent({
    actorId: record.userId,
    action: "password_reset.completed",
    entityType: "User",
    entityId: record.userId,
  });

  return "ok";
}
