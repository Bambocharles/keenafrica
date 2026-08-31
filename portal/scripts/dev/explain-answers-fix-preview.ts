// Session 33 — read-only preview: EXPLAIN the OLD vs NEW answers_select
// teacher-branch boolean expression directly (as a plain WHERE clause, not
// as an actual CREATE POLICY), to validate the proposed fix's cost
// reduction before the real migration is ever applied. No RLS objects are
// created or modified by this script.
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const url = process.env.RLS_TEST_DATABASE_URL;
if (!url) throw new Error("Set RLS_TEST_DATABASE_URL");
const prisma = new PrismaClient({ datasourceUrl: url });

const OLD_EXPR = `
  EXISTS (
    SELECT 1 FROM attempts att JOIN assessments asm ON asm.id = att.assessment_id
    JOIN cohorts c ON c.course_id = asm.course_id JOIN cohort_teachers ct ON ct.cohort_id = c.id
    WHERE att.id = answers.attempt_id AND ct.teacher_user_id = '${randomUUID()}'::uuid
  )
`;

const NEW_EXPR = `
  EXISTS (
    SELECT 1 FROM attempts att JOIN cohorts c ON c.course_id = att.course_id
    JOIN cohort_teachers ct ON ct.cohort_id = c.id
    WHERE att.id = answers.attempt_id AND ct.teacher_user_id = '${randomUUID()}'::uuid
  )
`;

function extractCost(plan: string) {
  const m = plan.match(/cost=[\d.]+\.\.([\d.]+)/);
  return { estCost: m ? parseFloat(m[1]) : null, nodeCount: (plan.match(/\(cost=/g) ?? []).length };
}

async function run(label: string, expr: string) {
  // Deliberately NOT "FROM answers" — that would also apply the real,
  // unmodified answers_select policy on top of our custom expression,
  // contaminating the comparison with cost that's identical in both cases.
  // A VALUES-derived pseudo-relation aliased as "answers" isolates just the
  // marginal cost of the EXISTS subquery itself (which still invokes the
  // real attempts_select/cohorts_select/cohort_teachers_select/
  // assessments_select policies on those actual tables).
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'false', true)`;
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN SELECT 1 FROM (VALUES ('${randomUUID()}'::uuid)) AS answers(attempt_id) WHERE ${expr}`
    );
  });
  const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
  const { estCost, nodeCount } = extractCost(plan);
  console.log(`\n===== ${label}: cost=${estCost} nodes=${nodeCount} =====`);
  console.log(plan);
}

async function main() {
  await run("OLD (through assessments)", OLD_EXPR);
  await run("NEW (through attempts.course_id)", NEW_EXPR);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
