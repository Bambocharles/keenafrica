// Session 46 (Full-Platform Security & RLS Audit), Part A — headroom probe.
//
// The depth audit answers "how deep is this policy". The EXPLAIN pass answers
// "is it over jit_above_cost TODAY". Neither answers the question that actually
// decides whether a deep policy needs the denormalization fix: *how much room
// is left before it crosses*. Session 31's P0 and Session 45's `assets`
// landmine were both "fine today, catastrophic one change later", so "under
// the threshold on today's 6 rows" is not a verdict — it is a starting point.
//
// This script grows a DISPOSABLE, version- and data-matched restore of
// production through a series of realistic volumes, re-ANALYZEs at each step
// (so the planner sees the new reality, exactly as production does now), and
// records where each deep policy's estimated plan cost lands relative to
// Postgres's jit_above_cost (100000) and jit_optimize_above_cost (500000).
//
// NEVER point this at production: it inserts rows. It refuses to run against a
// database whose name is not explicitly confirmed disposable.
//
// Usage:
//   HEADROOM_DATABASE_URL=postgresql://portal_rls_test@host:port/db \
//   HEADROOM_ADMIN_URL=postgresql://postgres@host:port/db \
//   HEADROOM_I_UNDERSTAND_THIS_WRITES_ROWS=yes \
//   npx tsx scripts/dev/rls-jit-headroom.ts
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

if (process.env.HEADROOM_I_UNDERSTAND_THIS_WRITES_ROWS !== "yes") {
  throw new Error(
    "Refusing to run. This script INSERTS rows. Set HEADROOM_I_UNDERSTAND_THIS_WRITES_ROWS=yes and point it only at a disposable restore."
  );
}
const readUrl = process.env.HEADROOM_DATABASE_URL;
const adminUrl = process.env.HEADROOM_ADMIN_URL;
if (!readUrl || !adminUrl) throw new Error("Set HEADROOM_DATABASE_URL and HEADROOM_ADMIN_URL");
for (const u of [readUrl, adminUrl]) {
  if (/192\.168\.2\.17|keenafrica_portal_prod@|kf_portal_prod/.test(u) && !/127\.0\.0\.1|localhost/.test(u)) {
    throw new Error(`Refusing to run against what looks like production: ${u.replace(/:[^:@/]*@/, ":***@")}`);
  }
}

const reader = new PrismaClient({ datasourceUrl: readUrl });
const admin = new PrismaClient({ datasourceUrl: adminUrl });

const JIT_ABOVE_COST = 100000;

// The deep SELECT policies worth tracking as volume grows: the two deepest in
// the schema (Session 45 flagged both as never having had the depth reduction
// applied to attempts_select/answers_select), plus the ones the rest of the
// platform reads on every page.
const TRACK = [
  "assets",
  "asset_attachments",
  "resources",
  "courses",
  "users",
  "lessons",
  "modules",
  "organization_invitations",
];

// Volumes to walk through. `assets`/`asset_attachments` today hold 6 and 5
// rows; these steps span "a real pilot cohort" to "a busy platform".
const STEPS = [100, 1_000, 10_000, 100_000];

async function measure(table: string) {
  return reader.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${randomUUID()}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'false', true)`;
    await tx.$executeRaw`SELECT set_config('app.permissions', '[]', true)`;
    await tx.$executeRaw`SELECT set_config('app.organization_ids', '[]', true)`;
    await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
    await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
    const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN SELECT * FROM "${table}"`
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    return {
      cost: parseFloat(plan.match(/cost=[\d.]+\.\.([\d.]+)/)?.[1] ?? "0"),
      jitFns: Number(plan.match(/Functions: (\d+)/)?.[1] ?? 0),
    };
  });
}

async function report(label: string) {
  const line: string[] = [label];
  for (const t of TRACK) {
    const { cost, jitFns } = await measure(t);
    line.push(`${t}=${cost.toFixed(0)}${cost >= JIT_ABOVE_COST ? `!JIT(${jitFns})` : ""}`);
  }
  console.log(line.join("  "));
}

async function main() {
  console.log(`# RLS deep-policy JIT headroom, estimated plan cost vs jit_above_cost=${JIT_ABOVE_COST}`);
  console.log(`# "!JIT(n)" marks a plan Postgres would JIT-compile, with n functions.\n`);

  const [{ uploader_id }] = await admin.$queryRaw<{ uploader_id: string }[]>`
    SELECT id AS uploader_id FROM users LIMIT 1`;

  await report("baseline (production data)");

  let created = 0;
  for (const target of STEPS) {
    const toAdd = target - created;
    // Each synthetic asset gets one attachment, matching production's real
    // shape (assets 6 / attachments 5) — this is growth, not a shape change.
    await admin.$executeRawUnsafe(
      `INSERT INTO assets (id, uploader_id, original_filename, mime_type, size_bytes,
         storage_driver, storage_key, checksum_sha256, status)
       SELECT gen_random_uuid(), $1::uuid, 'synthetic-' || g || '.bin', 'application/octet-stream',
              1024, 's3', 'synthetic/' || $2 || '/' || g, md5(g::text), 'active'
       FROM generate_series(1, $3::int) g`,
      uploader_id,
      randomUUID(),
      toAdd
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO asset_attachments (id, asset_id, entity_type, entity_id, attached_by)
       SELECT gen_random_uuid(), a.id, 'lesson_resource', gen_random_uuid(), $1::uuid
       FROM assets a
       WHERE a.original_filename LIKE 'synthetic-%'
         AND NOT EXISTS (SELECT 1 FROM asset_attachments x WHERE x.asset_id = a.id)`,
      uploader_id
    );
    created = target;
    await admin.$executeRawUnsafe(`ANALYZE assets, asset_attachments`);
    await report(`assets=${target} attachments~=${target}`);
  }

  console.log(`\n# Cleanup: removing every synthetic row.`);
  await admin.$executeRawUnsafe(
    `DELETE FROM asset_attachments WHERE asset_id IN (SELECT id FROM assets WHERE original_filename LIKE 'synthetic-%')`
  );
  await admin.$executeRawUnsafe(`DELETE FROM assets WHERE original_filename LIKE 'synthetic-%'`);
  await admin.$executeRawUnsafe(`ANALYZE assets, asset_attachments`);
  await report("after cleanup (should match baseline)");

  await reader.$disconnect();
  await admin.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await reader.$disconnect().catch(() => {});
  await admin.$disconnect().catch(() => {});
  process.exit(1);
});
