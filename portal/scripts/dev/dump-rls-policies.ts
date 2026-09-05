// Session 33 (Data Integrity / RLS Depth Audit) — dumps every RLS policy
// currently live in the schema (via pg_policies, the actual enforced
// definitions, not migration-file archaeology which can be stale/superseded)
// so Part 2's "enumerate every EXISTS-referencing-another-RLS-table policy"
// step has a single authoritative source to work from.
//
// Usage: RLS_TEST_DATABASE_URL=... npx tsx scripts/dev/dump-rls-policies.ts
import { PrismaClient } from "@prisma/client";

const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set RLS_TEST_DATABASE_URL or DATABASE_URL");

const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  const rows = await prisma.$queryRaw<
    { tablename: string; policyname: string; cmd: string; qual: string | null; with_check: string | null }[]
  >`
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;

  for (const r of rows) {
    console.log(`\n===== ${r.tablename}.${r.policyname} (${r.cmd}) =====`);
    if (r.qual) console.log(`USING:\n${r.qual}`);
    if (r.with_check) console.log(`WITH CHECK:\n${r.with_check}`);
  }
  console.log(`\n\n-- total policies: ${rows.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
