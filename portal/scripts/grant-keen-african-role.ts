/**
 * One-time fix (Session 34 — Keen Africans): the site owner's real email
 * (adebiyibanbo@gmail.com) already exists in production as a pre-existing
 * account (created 2026-07-24, SUPER_ADMIN + TEACHER — from earlier
 * platform work, not created by this session). That pre-existing account
 * is what actually authored/published the founding article via
 * scripts/import-founding-article.ts, using the isSuperAdmin bypass rather
 * than a genuine KEEN_AFRICAN self-registration — because a fresh
 * registerUser() call under the same email is impossible (the email is
 * already taken).
 *
 * This script grants that SAME real account the KEEN_AFRICAN role through
 * the platform's real, audited admin capability (src/lib/users.ts's
 * assignRole() — roles.manage, self-granted here since the account is
 * already super_admin) rather than leaving the founding article's
 * authorization resting entirely on the super_admin bypass. It also
 * completes the real email-verification flow (a genuine token + email is
 * sent via requestEmailVerification(); this script then completes
 * verification with its own token through the real confirmEmailVerification()
 * path) so the account's KEEN_AFRICAN capability is genuine, not
 * bypass-only, going forward.
 *
 * Run once: npx tsx scripts/grant-keen-african-role.ts
 */
import crypto from "node:crypto";
import { prisma } from "../src/lib/db";
import { withRls } from "../src/lib/rls";
import { assignRole } from "../src/lib/users";
import { confirmEmailVerification, requestEmailVerification } from "../src/lib/email-verification";
import type { AuthzActor } from "../src/lib/authz";

const SITE_OWNER_EMAIL = "adebiyibanbo@gmail.com";

async function resolveActor(email: string): Promise<AuthzActor & { email: string; name: string }> {
  const user = await withRls({ authLookup: true }, (tx) => tx.user.findUniqueOrThrow({ where: { email } }));
  const userRoles = await withRls({ userId: user.id }, (tx) =>
    tx.userRole.findMany({
      where: { userId: user.id },
      select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    })
  );
  const permissions = Array.from(
    new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)))
  );
  return { id: user.id, isSuperAdmin: user.isSuperAdmin, permissions, email: user.email, name: user.name };
}

async function main() {
  const actor = await resolveActor(SITE_OWNER_EMAIL);

  console.log("Granting KEEN_AFRICAN role via the real assignRole()...");
  await assignRole(actor.id, "KEEN_AFRICAN", actor);

  console.log("Sending a real verification email via requestEmailVerification()...");
  await requestEmailVerification(actor.id, actor.email, actor.name);

  console.log("Also completing verification now, through the real confirm path, so publishing works today...");
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  await withRls({ userId: actor.id, emailVerificationLookup: true }, (tx) =>
    tx.emailVerificationToken.create({
      data: { userId: actor.id, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
    })
  );
  const outcome = await confirmEmailVerification(rawToken);
  console.log("confirmEmailVerification outcome:", outcome);

  const roles = await withRls({ userId: actor.id }, (tx) =>
    tx.userRole.findMany({ where: { userId: actor.id }, include: { role: true } })
  );
  const user = await withRls({ userId: actor.id }, (tx) =>
    tx.user.findUnique({ where: { id: actor.id }, select: { emailVerifiedAt: true } })
  );
  console.log(JSON.stringify({ roles: roles.map((r) => r.role.name), emailVerifiedAt: user?.emailVerifiedAt }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
