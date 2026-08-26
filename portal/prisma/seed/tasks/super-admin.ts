import { hash } from "bcryptjs";
import type { SeedTask } from "../types";

// Creates/updates the first super-admin account. Requires explicit env vars
// so it can never silently create an account with a guessable password.
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

    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, name, isSuperAdmin: true },
      create: { email, passwordHash, name, isSuperAdmin: true },
    });

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
