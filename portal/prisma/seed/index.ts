// Seed framework entrypoint.
//   npm run seed        -> runs every "core" task (safe in any environment)
//   npm run seed:demo   -> also runs "demo" tasks, gated below
//
// Adding a new seed task: create prisma/seed/tasks/<name>.ts exporting a
// SeedTask (see ./types.ts), then list it in CORE_TASKS or DEMO_TASKS
// below. See docs/SEED_FRAMEWORK.md for the full convention.
import { PrismaClient } from "@prisma/client";
import type { SeedTask } from "./types";
import { assertDemoSeedAllowed } from "./guard";
import { rolesPermissionsTask } from "./tasks/roles-permissions";
import { superAdminTask } from "./tasks/super-admin";
import { featureFlagsTask } from "./tasks/feature-flags";
import { demoTask } from "./tasks/demo";

// Order matters: roles-permissions must run before super-admin, which
// links the seeded super-admin account to the SUPER_ADMIN role row.
const CORE_TASKS: SeedTask[] = [rolesPermissionsTask, superAdminTask, featureFlagsTask];
const DEMO_TASKS: SeedTask[] = [demoTask];

async function main() {
  const runDemo = process.argv.includes("--demo");
  const prisma = new PrismaClient();

  try {
    for (const task of CORE_TASKS) {
      await task.run(prisma);
    }

    if (runDemo) {
      assertDemoSeedAllowed(process.env);
      for (const task of DEMO_TASKS) {
        await task.run(prisma);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
