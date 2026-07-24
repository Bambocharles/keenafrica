// Creates the first super-admin account. Run by hand once:
//   SUPER_ADMIN_EMAIL=you@keenafrica.com SUPER_ADMIN_PASSWORD=... npm run seed
// Deliberately NOT wired into CI — reseeding on every deploy would be wrong.
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME ?? "Super Admin";

  if (!email || !password) {
    throw new Error(
      "Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars before running the seed script."
    );
  }

  // Bootstrap: no session context exists yet, so this must run with the
  // migrator role (bypasses RLS as table owner) — see README for details.
  const passwordHash = await hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name, isSuperAdmin: true },
    create: { email, passwordHash, name, isSuperAdmin: true },
  });

  console.log(`Super-admin ready: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
