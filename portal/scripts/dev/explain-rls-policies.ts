// Session 33 (Data Integrity / RLS Depth Audit), Part 2 — for every policy
// whose reference chain reaches 3+ distinct RLS-protected tables, run EXPLAIN
// under the real non-superuser portal_rls_test role with a session context
// that forces every OR-branch (including EXISTS subqueries) to actually be
// evaluated — no bypass permission, no super_admin, a user id that matches
// nothing. This reproduces Session 31 Bug 2's own repro shape exactly: a WHERE
// clause that is knowably false for every row, so ESTIMATED cost (which drives
// Postgres's JIT compilation threshold) is what's being measured, not actual
// execution cost against real matching data.
//
// Session 46 changed two things:
//
//  1. The candidate list is no longer hand-written. It was, and it had been
//     stale since Session 34 — it predated every Keen Africans table, so the
//     one thing Session 46 was asked to check could never have appeared in it,
//     and it also silently omitted `users` (whose `users_select` is depth 4 and
//     is where Session 29 found a real cross-organization PII leak). The list
//     now comes from the same pg_policies-derived graph as
//     `rls-depth-audit.ts`, so adding a table cannot quietly skip it.
//
//  2. It covers UPDATE and DELETE, not only SELECT. A policy's USING clause
//     lands in the plan as a scan qual for all three, so all three can cross
//     `jit_above_cost`; checking only SELECT left two thirds of the deep
//     policies unmeasured. INSERT is deliberately excluded and the reason is
//     asserted, not assumed — see checkInsertIsPlanFree() below.
//
// EXPLAIN alone never executes the statement, so the UPDATE/DELETE probes
// cannot modify data; they additionally run inside a rolled-back transaction.
// Run this against a disposable, version- and data-matched restore of
// production, never against production itself.
//
// Usage: RLS_TEST_DATABASE_URL=... npx tsx scripts/dev/explain-rls-policies.ts
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const url = process.env.RLS_TEST_DATABASE_URL;
if (!url) throw new Error("Set RLS_TEST_DATABASE_URL");

const prisma = new PrismaClient({ datasourceUrl: url });

// Postgres defaults. A plan whose ESTIMATED total cost crosses jit_above_cost
// gets JIT-compiled — which is the entire Session 31 P0 mechanism.
const JIT_ABOVE_COST = 100000;
const JIT_OPTIMIZE_ABOVE_COST = 500000;

type Probe = { table: string; cmd: string; policies: string[]; sql: string };

function extractCost(plan: string): { estCost: number | null; jit: boolean; nodeCount: number } {
  const m = plan.match(/cost=[\d.]+\.\.([\d.]+)/);
  const estCost = m ? parseFloat(m[1]) : null;
  const jit = /JIT:/.test(plan);
  const nodeCount = (plan.match(/\(cost=/g) ?? []).length;
  return { estCost, jit, nodeCount };
}

/** Session context that makes every EXISTS branch evaluate rather than short-circuit. */
async function setAdversarialContext(tx: {
  $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
}) {
  await tx.$executeRaw`SELECT set_config('app.user_id', ${randomUUID()}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'false', true)`;
  await tx.$executeRaw`SELECT set_config('app.permissions', '[]', true)`;
  await tx.$executeRaw`SELECT set_config('app.organization_ids', '[]', true)`;
  await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
  await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
}

/**
 * Derive the probe set straight from pg_policies, mirroring rls-depth-audit.ts.
 * Kept intentionally simple (direct + transitive table references, helpers
 * terminal) — the authoritative narrative version with the bypass-edge
 * analysis lives in rls-depth-audit.ts; this only needs the >=3 verdict.
 */
async function derivedDeepPolicies() {
  const policies = await prisma.$queryRaw<
    { tablename: string; policyname: string; cmd: string; qual: string | null; with_check: string | null }[]
  >`SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public'`;
  const tables = await prisma.$queryRaw<{ relname: string; rowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity AS rowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`;
  const funcs = await prisma.$queryRaw<{ proname: string; body: string }[]>`
    SELECT p.proname, pg_get_functiondef(p.oid) AS body FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname LIKE 'app\\_%'`;

  const all = new Set(tables.map((t) => t.relname));
  const rls = new Set(tables.filter((t) => t.rowsecurity).map((t) => t.relname));
  const refs = (expr: string) => {
    const out = new Set<string>();
    const re = /\b(?:FROM|JOIN)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) if (all.has(m[1].toLowerCase())) out.add(m[1].toLowerCase());
    return out;
  };
  const helperTables = new Map(funcs.map((f) => [f.proname, refs(f.body)]));
  const expand = (expr: string) => {
    const out = refs(expr);
    for (const [name, ts] of helperTables)
      if (new RegExp(`\\b${name}\\s*\\(`, "i").test(expr)) for (const t of ts) out.add(t);
    return out;
  };

  const selectEdges = new Map<string, Set<string>>();
  for (const t of all) selectEdges.set(t, new Set());
  for (const p of policies) {
    if (p.cmd !== "SELECT" && p.cmd !== "ALL") continue;
    for (const t of expand(p.qual ?? "")) if (t !== p.tablename) selectEdges.get(p.tablename)!.add(t);
  }

  return policies
    .map((p) => {
      const seen = new Set([p.tablename]);
      const queue = [...expand(`${p.qual ?? ""}\n${p.with_check ?? ""}`)].filter((t) => t !== p.tablename);
      for (const t of queue) seen.add(t);
      while (queue.length) {
        const cur = queue.shift()!;
        for (const t of selectEdges.get(cur) ?? []) if (!seen.has(t)) (seen.add(t), queue.push(t));
      }
      const depth = [...seen].filter((t) => rls.has(t)).length;
      return { ...p, depth };
    })
    .filter((p) => p.depth >= 3);
}

/**
 * An INSERT's WITH CHECK is not part of the plan tree — Postgres evaluates it
 * per row through ExecWithCheckOptions after the tuple is formed, so its cost
 * never reaches the planner's total and therefore cannot cross jit_above_cost.
 * That is the reason INSERT policies are excluded from the cost verdict above.
 * It is a load-bearing claim, so prove it rather than assert it: plan an INSERT
 * against the deepest WITH CHECK policy in the schema and confirm the estimate
 * is trivial.
 */
async function checkInsertIsPlanFree(table: string) {
  // Differential, not absolute: plan the same source SELECT twice, once as a
  // bare SELECT and once feeding an INSERT into the deep-WITH-CHECK table. Any
  // cost the WITH CHECK contributed to the plan would show up as a difference.
  // (A bare `EXPLAIN INSERT … SELECT` measured on its own proves nothing — the
  // source SELECT carries its own SELECT policy's cost.)
  return prisma.$transaction(async (tx) => {
    await setAdversarialContext(tx);
    const readPlan = (
      await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN SELECT * FROM "${table}" WHERE false`
      )
    )
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    const insertPlan = (
      await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN INSERT INTO "${table}" SELECT * FROM "${table}" WHERE false`
      )
    )
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    return { read: extractCost(readPlan), insert: extractCost(insertPlan) };
  });
}

/**
 * A no-op self-assignment column for the UPDATE probe. Not every table has an
 * `id` (join tables like assessment_questions use a composite key), so pick the
 * first ordinary column rather than assuming one.
 */
async function updateProbeColumns(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT DISTINCT ON (table_name) table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND is_generated = 'NEVER'
    ORDER BY table_name, ordinal_position
  `;
  return new Map(rows.map((r) => [r.table_name, r.column_name]));
}

async function main() {
  const deep = await derivedDeepPolicies();
  const updateCols = await updateProbeColumns(prisma);

  // One probe per (table, cmd) — the planner applies every policy for that
  // command together, so that is the unit a JIT verdict actually applies to.
  const byProbe = new Map<string, Probe>();
  for (const p of deep) {
    if (p.cmd === "INSERT") continue; // see checkInsertIsPlanFree()
    const key = `${p.tablename}|${p.cmd}`;
    const sql =
      p.cmd === "SELECT"
        ? `EXPLAIN SELECT * FROM "${p.tablename}"`
        : p.cmd === "DELETE"
          ? `EXPLAIN DELETE FROM "${p.tablename}"`
          : `EXPLAIN UPDATE "${p.tablename}" SET "${updateCols.get(p.tablename)}" = "${updateCols.get(p.tablename)}"`;
    const existing = byProbe.get(key);
    if (existing) existing.policies.push(p.policyname);
    else byProbe.set(key, { table: p.tablename, cmd: p.cmd, policies: [p.policyname], sql });
  }

  const results: {
    table: string;
    cmd: string;
    policies: string[];
    estCost: number | null;
    jit: boolean;
    nodeCount: number;
    error?: string;
  }[] = [];

  for (const probe of [...byProbe.values()].sort((a, b) =>
    a.table.localeCompare(b.table) || a.cmd.localeCompare(b.cmd)
  )) {
    try {
      const plan = await prisma.$transaction(async (tx) => {
        await setAdversarialContext(tx);
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(probe.sql);
        return rows.map((r) => r["QUERY PLAN"]).join("\n");
      });
      const { estCost, jit, nodeCount } = extractCost(plan);
      results.push({ ...probe, estCost, jit, nodeCount });
      console.log(`\n===== ${probe.table} [${probe.cmd}] (${probe.policies.join(", ")}) =====`);
      console.log(plan);
    } catch (err) {
      results.push({ ...probe, estCost: null, jit: false, nodeCount: 0, error: String(err) });
      console.log(`\n===== ${probe.table} [${probe.cmd}] (ERROR) =====`);
      console.log(String(err));
    }
  }

  // The headline verdict. "Under jit_above_cost today" is not an answer — it is
  // what `attempts_select` and `assets` both said right up until they weren't
  // (Session 31's P0, Session 45's landmine). What decides whether a policy is
  // safe is its cost PER ROW, because that constant is set by the policy's own
  // depth and is independent of how much data the tables it references hold
  // (measured: growing `resources` 2 -> 500 moved resources_select 223 ->
  // 55,473 and left asset_attachments_select unchanged at 1,034). So the useful
  // number is: how many rows can a query touch before this policy's estimated
  // plan cost crosses jit_above_cost.
  const liveRows = new Map(
    (
      await prisma.$queryRaw<{ relname: string; n: number }[]>`
        SELECT c.relname, GREATEST(c.reltuples, 1)::int AS n
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relkind = 'r'`
    ).map((r) => [r.relname, r.n])
  );

  console.log("\n\n=== HEADROOM: rows a query may touch before this policy crosses jit_above_cost ===");
  console.log("table | cmd | rows_now | cost_now | cost_per_row | rows_to_JIT_threshold");
  const headroom = results
    .filter((r) => r.estCost != null && r.estCost > 0)
    .map((r) => {
      const rows = liveRows.get(r.table) ?? 1;
      const perRow = r.estCost! / rows;
      return { ...r, rows, perRow, toThreshold: perRow > 0 ? Math.floor(JIT_ABOVE_COST / perRow) : Infinity };
    })
    .sort((a, b) => a.toThreshold - b.toThreshold);
  for (const r of headroom) {
    console.log(
      `${r.table} | ${r.cmd} | ${r.rows} | ${r.estCost!.toFixed(0)} | ${r.perRow.toFixed(1)} | ${r.toThreshold.toLocaleString()}`
    );
  }

  console.log("\n\n=== SUMMARY ===");
  console.log(
    `policies at depth>=3: ${deep.length} (${deep.filter((d) => d.cmd === "INSERT").length} INSERT, plan-free by construction)`
  );
  console.log(
    "table | cmd | policies | estimated_cost | node_count | jit_section | vs_jit_above_cost(100000) | vs_jit_optimize_above_cost(500000)"
  );
  for (const r of results.sort((a, b) => (b.estCost ?? 0) - (a.estCost ?? 0))) {
    const f1 = r.estCost != null && r.estCost >= JIT_ABOVE_COST ? "OVER" : "under";
    const f2 = r.estCost != null && r.estCost >= JIT_OPTIMIZE_ABOVE_COST ? "OVER" : "under";
    console.log(
      `${r.table} | ${r.cmd} | ${r.policies.join("+")} | ${r.estCost ?? "ERROR"} | ${r.nodeCount} | ${r.jit} | ${f1} | ${f2}`
    );
  }

  // Second pass: EXPLAIN (ANALYZE, BUFFERS) on the SELECT probes. ANALYZE
  // executes, so it is confined to the read-only probes. Estimated cost is
  // what actually drives the JIT decision, so the first pass is the verdict;
  // this pass is the corroborating real-world measurement — the number that
  // would have made Session 31's P0 unmissable (6.7s, 2148 JIT functions) and
  // Session 45's `assets` landmine visible (15,399 ms, 4,796 functions).
  console.log("\n\n=== EXPLAIN (ANALYZE, BUFFERS), SELECT probes ===");
  console.log("table | exec_ms | shared_hit+read | jit_functions | jit_time_ms");
  for (const probe of [...byProbe.values()].filter((p) => p.cmd === "SELECT").sort((a, b) =>
    a.table.localeCompare(b.table)
  )) {
    try {
      const plan = await prisma.$transaction(async (tx) => {
        await setAdversarialContext(tx);
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
          `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "${probe.table}"`
        );
        return rows.map((r) => r["QUERY PLAN"]).join("\n");
      });
      const ms = plan.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? "?";
      const hit = [...plan.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)].reduce(
        (a, m) => a + Number(m[1]) + Number(m[2] ?? 0),
        0
      );
      const fns = plan.match(/Functions: (\d+)/)?.[1] ?? "0";
      const jitMs = plan.match(/Timing:.*Total ([\d.]+) ms/)?.[1] ?? "0";
      console.log(`${probe.table} | ${ms} | ${hit} | ${fns} | ${jitMs}`);
    } catch (err) {
      console.log(`${probe.table} | ERROR | ${String(err).slice(0, 120)}`);
    }
  }

  const ins = await checkInsertIsPlanFree("asset_attachments");
  const delta = (ins.insert.estCost ?? 0) - (ins.read.estCost ?? 0);
  console.log(
    `\nINSERT control (asset_attachments, deepest WITH CHECK in the schema):` +
      `\n  bare SELECT of the same source: cost=${ins.read.estCost}, nodes=${ins.read.nodeCount}` +
      `\n  same source feeding INSERT:     cost=${ins.insert.estCost}, nodes=${ins.insert.nodeCount}` +
      `\n  cost contributed by WITH CHECK: ${delta}` +
      `\n  => ${delta === 0 ? "CONFIRMED" : "NOT confirmed"}: WITH CHECK is evaluated per row outside the plan, so an INSERT policy cannot cross a plan-cost JIT threshold no matter how deep it is.`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
