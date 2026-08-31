// Session 33 (Data Integrity / RLS Depth Audit), Part 2 — for every table
// whose SELECT-applicable RLS policy references another RLS-protected table
// (per scripts/dev/dump-rls-policies.ts's graph), run EXPLAIN under the real
// non-superuser portal_rls_test role with a session context that forces
// every OR-branch (including EXISTS subqueries) to actually be evaluated —
// no bypass permission, no super_admin, a user id that matches nothing.
// This reproduces Session 31 Bug 2's own repro shape exactly: a WHERE
// clause that is knowably false for every row, so ESTIMATED cost (which
// drives Postgres's JIT compilation threshold) is what's being measured,
// not actual execution cost against real matching data.
//
// Usage: RLS_TEST_DATABASE_URL=... npx tsx scripts/dev/explain-rls-policies.ts
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const url = process.env.RLS_TEST_DATABASE_URL;
if (!url) throw new Error("Set RLS_TEST_DATABASE_URL");

const prisma = new PrismaClient({ datasourceUrl: url });

// Candidate tables: every table whose SELECT/ALL policy's reference chain
// reaches 3+ distinct RLS-protected tables (dump-rls-policies.ts + graph
// analysis). Baseline leaf tables (cohort_teachers, enrollments alone) are
// excluded — they're the well-tested bottom of every chain, not new risk.
const CANDIDATES = [
  "answers",
  "assessment_assignments",
  "assessment_questions",
  "assessment_versions",
  "assessments",
  "asset_attachments",
  "assets",
  "attempts",
  "certificates",
  "cohorts",
  "courses",
  "lesson_progress",
  "lesson_topics",
  "lesson_versions",
  "lessons",
  "modules",
  "organization_invitations",
  "question_options",
  "question_topics",
  "questions",
  "resources",
];

function extractCost(plan: string): { estCost: number | null; jit: boolean; nodeCount: number } {
  const m = plan.match(/cost=[\d.]+\.\.([\d.]+)/);
  const estCost = m ? parseFloat(m[1]) : null;
  const jit = /JIT:/.test(plan);
  const nodeCount = (plan.match(/\(cost=/g) ?? []).length;
  return { estCost, jit, nodeCount };
}

async function main() {
  const results: { table: string; estCost: number | null; jit: boolean; nodeCount: number; error?: string }[] = [];

  for (const table of CANDIDATES) {
    try {
      const rows = await prisma.$transaction(async (tx) => {
        // A user id that matches nothing, no permissions, not super admin —
        // forces every EXISTS/OR branch to actually be evaluated instead of
        // short-circuiting on a constant-true condition.
        await tx.$executeRaw`SELECT set_config('app.user_id', ${randomUUID()}, true)`;
        await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'false', true)`;
        await tx.$executeRaw`SELECT set_config('app.permissions', '[]', true)`;
        await tx.$executeRaw`SELECT set_config('app.organization_ids', '[]', true)`;
        await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
        await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
        return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
          `EXPLAIN SELECT * FROM "${table}"`
        );
      });
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      const { estCost, jit, nodeCount } = extractCost(plan);
      results.push({ table, estCost, jit, nodeCount });
      console.log(`\n===== ${table} =====`);
      console.log(plan);
    } catch (err) {
      results.push({ table, estCost: null, jit: false, nodeCount: 0, error: String(err) });
      console.log(`\n===== ${table} (ERROR) =====`);
      console.log(String(err));
    }
  }

  console.log("\n\n=== SUMMARY ===");
  console.log("table | estimated_cost | node_count | jit_section_present | vs_jit_above_cost(100000) | vs_jit_optimize_above_cost(500000)");
  for (const r of results.sort((a, b) => (b.estCost ?? 0) - (a.estCost ?? 0))) {
    const flag100k = r.estCost != null && r.estCost >= 100000 ? "OVER" : "under";
    const flag500k = r.estCost != null && r.estCost >= 500000 ? "OVER" : "under";
    console.log(`${r.table} | ${r.estCost ?? "ERROR"} | ${r.nodeCount} | ${r.jit} | ${flag100k} | ${flag500k}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
