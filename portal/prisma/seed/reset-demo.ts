// Deterministic demo-data reset (testing/demo-data.md's "Demo reset"
// contract): wipe every canonical demo record, then recreate the exact
// same baseline from scratch via the real seed tasks. Never touches
// anything outside the demo universe — every id this script deletes is
// discovered by the same stable names/email-domain constants
// (./tasks/demo/constants.ts) the seed itself writes, never a heuristic
// that could drift from what was actually seeded.
//
// Usage:  npm run demo:reset
//
// Safety: reuses prisma/seed/guard.ts's assertDemoSeedAllowed() — the exact
// same "NODE_ENV !== production AND ALLOW_DEMO_SEED=true" gate `npm run
// seed:demo` itself enforces — checked BEFORE this script deletes a single
// row. There is no separate/weaker safety mechanism here; production
// rejects this exactly as it rejects seed:demo, per
// CLAUDE_BUILD_RULES.md §10's "make the reset process impossible to run
// against production."
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedAllowed } from "./guard";
import { rolesPermissionsTask } from "./tasks/roles-permissions";
import { superAdminTask } from "./tasks/super-admin";
import { featureFlagsTask } from "./tasks/feature-flags";
import { demoTask } from "./tasks/demo";
import {
  cleanupTestCourses,
  cleanupTestOrganizations,
  cleanupTestProjects,
  cleanupTestSponsors,
  cleanupTestTopics,
  cleanupTestUsers,
} from "@/lib/test-support";
import {
  DEMO_COURSE_TITLES,
  DEMO_EMAIL_DOMAIN,
  DEMO_ORGANIZATION_NAMES,
  DEMO_SPONSOR_NAMES,
  DEMO_TOPIC_NAMES,
} from "./tasks/demo/constants";

async function wipeDemoData(prisma: PrismaClient): Promise<void> {
  const [courses, sponsors, projects, topics, organizations, users] = await Promise.all([
    prisma.course.findMany({
      where: { title: { in: [...DEMO_COURSE_TITLES] }, creator: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } },
      select: { id: true },
    }),
    prisma.sponsor.findMany({ where: { name: { in: [...DEMO_SPONSOR_NAMES] } }, select: { id: true } }),
    prisma.project.findMany({ where: { sponsor: { name: { in: [...DEMO_SPONSOR_NAMES] } } }, select: { id: true } }),
    prisma.topic.findMany({ where: { name: { in: [...DEMO_TOPIC_NAMES] } }, select: { id: true } }),
    prisma.organization.findMany({ where: { name: { in: [...DEMO_ORGANIZATION_NAMES] } }, select: { id: true } }),
    prisma.user.findMany({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } }, select: { id: true } }),
  ]);

  console.log(
    `[demo:reset] wiping ${courses.length} course(s), ${projects.length} project(s), ${sponsors.length} sponsor(s), ` +
      `${topics.length} topic(s), ${organizations.length} organization(s), ${users.length} user(s)...`
  );

  // Dependency order — courses/projects/sponsors/topics/organizations
  // before users, since their rows (and everything cascaded off them)
  // still reference user ids via ON DELETE NO ACTION foreign keys. See
  // test-support.ts's own docstrings for the full per-function cascade.
  await cleanupTestCourses(courses.map((c) => c.id));
  await cleanupTestProjects(projects.map((p) => p.id));
  await cleanupTestSponsors(sponsors.map((s) => s.id));
  await cleanupTestTopics(topics.map((t) => t.id));
  await cleanupTestOrganizations(organizations.map((o) => o.id));
  await cleanupTestUsers(users.map((u) => u.id));
}

async function main() {
  assertDemoSeedAllowed(process.env);

  const prisma = new PrismaClient();
  try {
    await wipeDemoData(prisma);

    console.log("[demo:reset] recreating baseline...");
    await rolesPermissionsTask.run(prisma);
    await superAdminTask.run(prisma);
    await featureFlagsTask.run(prisma);
    await demoTask.run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
