import crypto from "node:crypto";
import { withRls } from "@/lib/rls";
import { recordAuditEvent } from "@/lib/audit";
import { sendMail } from "@/lib/mailer";

/**
 * Email verification (Session 34 — Keen Africans). Same shape as
 * src/lib/password-reset.ts throughout: a single-use, hashed, TTL'd token,
 * with a pre-auth RLS carve-out (app.email_verification_lookup) for the
 * consume step, since there's no app.user_id yet at the point a link is
 * clicked from an email client.
 *
 * This is the abuse-model decision sessions/34-keen-africans.md item 3
 * calls for: open self-registration with no approval gate needs SOME
 * friction before a stranger's first public-facing publish under the
 * keenafrica.com domain. Scoped narrowly — only
 * src/lib/articles.ts's publishArticle() reads emailVerifiedAt today; login
 * itself is unaffected, so an unverified account can still sign in, draft,
 * and preview, just not publish.
 */

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — a mailbox check is not as time-sensitive as a password reset link.

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates a token, records it, and attempts delivery via the shared mailer.
 * Never throws on mail-delivery failure — the account already exists by the
 * time this is called (see keenafricans/register's Server Action), and a
 * transient provider error shouldn't be surfaced as a registration failure.
 * The caller can always trigger a resend from the dashboard.
 */
export async function requestEmailVerification(userId: string, email: string, name: string): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

  await withRls({ userId, emailVerificationLookup: true }, (tx) =>
    tx.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } })
  );

  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
  const link = `https://keenafricans.${rootDomain}/verify-email?token=${rawToken}`;

  try {
    await sendMail({
      to: email,
      subject: "Verify your email to publish on Keen Africans",
      text: `Hi ${name},\n\nYou can draft and preview articles right away. To publish your first article publicly, verify your email address:\n\n${link}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this message.`,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[email-verification] sendMail failed", err);
  }

  await recordAuditEvent({
    actorId: userId,
    action: "email_verification.requested",
    entityType: "User",
    entityId: userId,
  });
}

export type ConfirmEmailVerificationOutcome = "ok" | "invalid_or_expired";

export async function confirmEmailVerification(rawToken: string): Promise<ConfirmEmailVerificationOutcome> {
  const tokenHash = hashToken(rawToken);

  const record = await withRls({ emailVerificationLookup: true }, (tx) =>
    tx.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    })
  );

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    return "invalid_or_expired";
  }

  await withRls({ userId: record.userId, emailVerificationLookup: true }, async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await tx.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  });

  await recordAuditEvent({
    actorId: record.userId,
    action: "email_verification.completed",
    entityType: "User",
    entityId: record.userId,
  });

  return "ok";
}

/** For the dashboard's own "check my status"/"resend" affordance. */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const user = await withRls({ userId }, (tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } })
  );
  return Boolean(user?.emailVerifiedAt);
}
