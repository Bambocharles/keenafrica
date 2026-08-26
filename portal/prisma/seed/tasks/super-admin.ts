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

    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, name, isSuperAdmin: true },
      create: { email, passwordHash, name, isSuperAdmin: true },
    });

    console.log(`[super-admin] ready: ${email}`);
  },
};
