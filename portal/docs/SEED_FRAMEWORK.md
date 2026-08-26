# Seed framework

`prisma/seed/index.ts` is a small task runner, not a single script:

```
prisma/seed/
  index.ts            # runner/orchestrator
  types.ts             # SeedTask interface
  tasks/
    super-admin.ts     # kind: "core"
    feature-flags.ts   # kind: "core"
    demo.ts             # kind: "demo" — stub, owned by Session 15
```

## Task kinds

- **`core`** — safe in any environment, including production. Must be
  idempotent (`upsert`, not `create`) and must never create fake business
  data (sponsors, projects, students, etc.). Runs on every `npm run seed`.
- **`demo`** — synthetic/demo data such as CLAUDE_BUILD_RULES.md §10's
  canonical dataset. Only runs via `npm run seed:demo`, and only if the
  runner's guard passes:
  - `NODE_ENV` must not be `production`, **and**
  - `ALLOW_DEMO_SEED=true` must be set explicitly.

  Both checks live in the runner (`index.ts`), not in individual tasks —
  a new demo task doesn't need to re-implement the guard.

## Running

```bash
npm run seed          # core tasks only — safe anywhere, including prod
ALLOW_DEMO_SEED=true npm run seed:demo   # core + demo tasks (dev/staging only)
```

`npm run seed` is not wired into CI or the deploy pipeline — it's a
by-hand bootstrap/maintenance command, run against the migrator connection
(same reasoning as the original single-file seed script: reseeding on every
deploy would be wrong, and RLS would block most of this as the app role).

## Adding a task

1. Create `prisma/seed/tasks/<name>.ts` exporting a `SeedTask` (see
   `prisma/seed/types.ts`): `{ name, kind, run(prisma) }`.
2. Register it in `CORE_TASKS` or `DEMO_TASKS` in `prisma/seed/index.ts`.
3. Make `run()` idempotent — it will be called against a database that may
   already have this task's rows from a previous run.

## What Session 15 owns

`prisma/seed/tasks/demo.ts` is a placeholder that throws
"not implemented yet" if `seed:demo` is ever actually invoked. Session 15
(Demo & Test Environment) replaces its body with the canonical dataset
described in `testing/demo-data.md` — new/not-started, active, partially
complete, nearly complete, complete, and inactive states across
enrollments, scores, messages, notes, and notifications, per
CLAUDE_BUILD_RULES.md §10. It should stay a single `demo` task (or split
into several `demo`-kind tasks) rather than becoming its own runner —
reuse this framework's guard, don't rebuild it.
