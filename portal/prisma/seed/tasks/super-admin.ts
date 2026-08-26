import { hash } from "bcryptjs";
import type { SeedTask } from "../types";

// Creates the first super-admin account. Requires explicit env vars so it
// can never silently create an account with a guessable password.
//
// Deliberately does NOT overwrite passwordHash for an account that already
// exists — only account creation sets a password from these env vars.
// This task is "core" (safe to run in any environment, including
// production, per prisma/seed/types.ts), and it is also the ONLY practical
// way today to (re)populate roles/permissions in an already-deployed
// environment (there is no seed step in deploy-portal.yml — see
// docs/IDENTITY_SECURITY.md). Re-running it against production with a
// stale/placeholder SUPER_ADMIN_PASSWORD must never reset a real admin's
// live password as a side effect of that. To deliberately change an
// existing super-admin's password, use resetPassword()
// (src/lib/password-reset.ts) or a direct SQL update, not this task.
export const superAdminTask: SeedTask = {
  name: "super-admin",
  kind: "core",
  async run(prisma) {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const name = process.env.SUPER_ADMIN_NAME ?? "Super Admin";

    if (!email || !password) {
      console.log(
        "[super-admin] SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD not set — skipping."
      );
      return;
    }

    // Bootstrap: no session context exists yet, so this must run with the
    // migrator role (bypasses RLS as table owner) — see README for details.
    const passwordHash = await hash(password, 12);

    const existing = await prisma.user.findUnique({ where: { email } });
    const user = existing
      ? await prisma.user.update({ where: { email }, data: { name, isSuperAdmin: true } })
      : await prisma.user.create({ data: { email, passwordHash, name, isSuperAdmin: true } });

    if (existing) {
      console.log(`[super-admin] ${email} already exists — left password unchanged.`);
    }

    // isSuperAdmin remains the actual RLS/authz bypass; the SUPER_ADMIN
    // role assignment is for consistency (so this account is visible in
    // any future "who has which role" admin view), not the source of its
    // authority. Requires roles-permissions to have run first.
    const superAdminRole = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
    if (superAdminRole) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
        update: {},
        create: { userId: user.id, roleId: superAdminRole.id },
      });
    }

    console.log(`[super-admin] ready: ${email}`);
  },
};
