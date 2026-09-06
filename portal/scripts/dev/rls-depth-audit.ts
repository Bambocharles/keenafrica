// Session 46 (Full-Platform Security & RLS Audit), Part A — completes the
// audit Session 33 started and never finished.
//
// Session 33's `dump-rls-policies.ts` printed every policy; deciding which
// ones were deep was then done by eye, and `explain-rls-policies.ts` was given
// a hand-written CANDIDATES list. That list has been stale since Session 34 —
// it predates every Keen Africans table (articles, comments, reports, follows,
// article_reactions, article_views, profiles, keen_african_verifications) and
// so could never have flagged them. This script removes the human step: it
// derives the reference graph from `pg_policies` itself and reports, for every
// policy, the transitive set of RLS-protected tables its qual/with_check
// reaches. That is the number that predicts the Session 31 P0 mechanism —
// nested EXISTS subqueries multiplying out to an ESTIMATED plan cost over
// Postgres's `jit_above_cost` (100000), which then JIT-compiles thousands of
// functions for a query returning almost nothing.
//
// Two kinds of edge are followed, and they are NOT equivalent:
//   - a plain table reference (`FROM cohorts c`): Postgres re-applies that
//     table's own SELECT policy inside the subquery, so the chain continues
//     and BOTH cost and access semantics inherit from it.
//   - a SECURITY DEFINER helper (`app_current_user_enrolled_cohort_ids()`):
//     the helper reads its table with RLS bypassed. It adds one table to the
//     cost graph but the chain STOPS there — no nested policy is applied.
//     That asymmetry is not a footnote: it is exactly what caused Session 29's
//     cross-organization PII leak, where a policy layered on a bypass helper
//     silently failed to inherit Session 21's organization boundary. The
//     report marks these edges so both properties stay visible.
//
// Usage:
//   AUDIT_DATABASE_URL=postgresql://... npx tsx scripts/dev/rls-depth-audit.ts
// Falls back to RLS_TEST_DATABASE_URL, then DATABASE_URL.
import { PrismaClient } from "@prisma/client";

const url =
  process.env.AUDIT_DATABASE_URL ??
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL;
if (!url) throw new Error("Set AUDIT_DATABASE_URL, RLS_TEST_DATABASE_URL or DATABASE_URL");

const prisma = new PrismaClient({ datasourceUrl: url });

type PolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

type FuncRow = { proname: string; prosecdef: boolean; body: string };

/**
 * Pull every table name a policy expression references. Postgres normalises
 * `pg_policies.qual` into a canonical form, so the only shapes that introduce
 * a relation are `FROM <rel>` and `JOIN <rel>` (optionally schema-qualified
 * and/or aliased, optionally double-quoted).
 */
function referencedTables(expr: string, known: Set<string>): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:FROM|JOIN)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    const name = m[1].toLowerCase();
    if (known.has(name)) out.add(name);
  }
  return out;
}

function referencedHelpers(expr: string, helpers: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const h of helpers) {
    if (new RegExp(`\\b${h}\\s*\\(`, "i").test(expr)) out.add(h);
  }
  return out;
}

async function main() {
  const policies = await prisma.$queryRaw<PolicyRow[]>`
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;

  const tableRows = await prisma.$queryRaw<{ relname: string; rowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity AS rowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `;
  const allTables = new Set(tableRows.map((t) => t.relname));
  const rlsTables = new Set(tableRows.filter((t) => t.rowsecurity).map((t) => t.relname));

  const funcs = await prisma.$queryRaw<FuncRow[]>`
    SELECT p.proname, p.prosecdef, pg_get_functiondef(p.oid) AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname LIKE 'app\\_%'
  `;
  const helperTables = new Map<string, { tables: Set<string>; secdef: boolean }>();
  for (const f of funcs) {
    helperTables.set(f.proname, {
      tables: referencedTables(f.body, allTables),
      secdef: f.prosecdef,
    });
  }
  const helperNames = new Set(helperTables.keys());

  // Direct edges per table, aggregated over that table's SELECT-applicable
  // policies — that is what a nested subquery on it will actually evaluate.
  const selectEdges = new Map<string, { direct: Set<string>; viaHelper: Set<string> }>();
  for (const t of allTables) selectEdges.set(t, { direct: new Set(), viaHelper: new Set() });
  for (const p of policies) {
    if (p.cmd !== "SELECT" && p.cmd !== "ALL") continue;
    const expr = p.qual ?? "";
    const e = selectEdges.get(p.tablename)!;
    for (const t of referencedTables(expr, allTables)) if (t !== p.tablename) e.direct.add(t);
    for (const h of referencedHelpers(expr, helperNames))
      for (const t of helperTables.get(h)!.tables) e.viaHelper.add(t);
  }

  type Verdict = {
    policy: string;
    cmd: string;
    directTables: string[];
    helperTables: string[];
    transitive: string[];
    depth: number;
    bypassEdge: boolean;
  };
  const verdicts: Verdict[] = [];

  for (const p of policies) {
    const expr = `${p.qual ?? ""}\n${p.with_check ?? ""}`;
    const direct = referencedTables(expr, allTables);
    direct.delete(p.tablename);
    const helpers = referencedHelpers(expr, helperNames);
    const viaHelper = new Set<string>();
    for (const h of helpers) for (const t of helperTables.get(h)!.tables) viaHelper.add(t);

    // Transitive closure. Plain references continue the chain (their SELECT
    // policy is re-applied); helper references contribute their table and stop.
    const seen = new Set<string>([p.tablename]);
    let bypassEdge = viaHelper.size > 0;
    const queue: string[] = [];
    for (const t of direct) if (!seen.has(t)) (seen.add(t), queue.push(t));
    for (const t of viaHelper) seen.add(t); // terminal: RLS bypassed inside the helper
    while (queue.length) {
      const cur = queue.shift()!;
      const e = selectEdges.get(cur);
      if (!e) continue;
      for (const t of e.direct) if (!seen.has(t)) (seen.add(t), queue.push(t));
      if (e.viaHelper.size > 0) bypassEdge = true;
      for (const t of e.viaHelper) seen.add(t);
    }

    const transitive = [...seen].filter((t) => rlsTables.has(t)).sort();
    verdicts.push({
      policy: `${p.tablename}.${p.policyname}`,
      cmd: p.cmd,
      directTables: [...direct].sort(),
      helperTables: [...viaHelper].sort(),
      transitive,
      depth: transitive.length,
      bypassEdge,
    });
  }

  const deep = verdicts.filter((v) => v.depth >= 3).sort((a, b) => b.depth - a.depth);
  const shallow = verdicts.filter((v) => v.depth < 3);

  console.log(`# RLS policy reference-depth audit`);
  console.log(`# total policies: ${verdicts.length}`);
  console.log(`# RLS-enabled tables: ${rlsTables.size} of ${allTables.size}`);
  console.log(
    `# policies with 3+ table reference depth (Session 33 Part A threshold): ${deep.length}\n`
  );

  console.log(`## 3+ table reference depth — require a live EXPLAIN verdict\n`);
  console.log(`policy | cmd | depth | bypass_edge | transitive reference set`);
  for (const v of deep) {
    console.log(
      `${v.policy} | ${v.cmd} | ${v.depth} | ${v.bypassEdge ? "YES" : "no"} | ${v.transitive.join(", ")}`
    );
  }

  console.log(`\n## depth 1-2 — flat or single-hop, not a JIT-threshold risk\n`);
  console.log(`policy | cmd | depth | transitive reference set`);
  for (const v of shallow.sort((a, b) => b.depth - a.depth || a.policy.localeCompare(b.policy))) {
    console.log(`${v.policy} | ${v.cmd} | ${v.depth} | ${v.transitive.join(", ") || "(self only)"}`);
  }

  // Machine-readable, so explain-rls-policies.ts and the regression test can
  // consume the same derived list instead of a hand-maintained one.
  console.log(`\n## deep tables (JSON, for explain-rls-policies.ts)\n`);
  console.log(JSON.stringify([...new Set(deep.map((v) => v.policy.split(".")[0]))].sort()));

  const tablesWithoutRls = [...allTables].filter(
    (t) => !rlsTables.has(t) && !t.startsWith("_prisma")
  );
  if (tablesWithoutRls.length) {
    console.log(`\n## tables with RLS NOT enabled\n`);
    console.log(tablesWithoutRls.sort().join(", "));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
