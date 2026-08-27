# Seed framework

`prisma/seed/index.ts` is a small task runner, not a single script:

```
prisma/seed/
  index.ts            # runner/orchestrator
  reset-demo.ts        # wipe + recreate the demo universe — `npm run demo:reset`
  types.ts             # SeedTask interface
  tasks/
    super-admin.ts     # kind: "core"
    feature-flags.ts   # kind: "core"
    demo.ts             # kind: "demo" — thin wrapper, see tasks/demo/
    demo/               # the canonical demo/test universe (Session 15)
      constants.ts       # stable names/domain shared with reset-demo.ts
      identity.ts         # admins/troubleshooters/teachers/students/sponsor users
      content.ts           # courses/cohorts/modules/lessons/assessments
      activity.ts           # enrollment/progress/attempts/notes/bookmarks/certs
      messaging.ts           # announcements + direct threads
      sponsor.ts              # sponsors/projects/milestones/metrics/documents
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
ALLOW_DEMO_SEED=true npm run demo:reset  # wipe + recreate the demo universe (dev/staging only)
```

`seed:demo` refuses to run a second time on top of already-present demo data
(it detects any `@demo.keenafrica.dev` user and throws, telling you to run
`demo:reset` instead) — this keeps a partial/duplicated seed from ever
silently happening. `demo:reset` is the deterministic reset process
CLAUDE_BUILD_RULES.md §10 requires: it deletes every row the demo seed is
known to have created (by the stable names/email domain in
`tasks/demo/constants.ts`, never a heuristic), then re-runs the core tasks
and the demo task from scratch — the same guard (`ALLOW_DEMO_SEED=true` and
`NODE_ENV !== production`) gates both halves, so there is no separate,
weaker path to wipe/reseed than to seed in the first place. See
`docs/DEMO_DATA.md` for the full canonical universe and demo credentials.

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

## What Session 15 built

`prisma/seed/tasks/demo.ts` delegates to `tasks/demo/index.ts`
(`runDemoSeed()`), which builds the canonical dataset described in
`testing/demo-data.md` — new/not-started, active, halfway, nearly-complete,
complete, and inactive/withdrawn enrollment states, suspended accounts,
assessment attempts across every status (`in_progress`/`submitted`/
`graded`) with different scores, notes, bookmarks, teacher announcements,
direct messages, unread/read notifications, certificates for completed
students, and sponsor projects/milestones/metrics/documents/beneficiaries —
per CLAUDE_BUILD_RULES.md §10.

Every mutation goes through the real `src/lib/*.ts` API (`createCourse`,
`enrollStudent`, `markLessonComplete`, `submitAttempt`,
`issueCertificateIfEligible`, `startConversation`, `createProject`, ...),
never a raw `prisma.create` bypassing authorization/RLS ownership checks —
the same principle `education-vertical-slice.test.ts` already established
for tests, applied here to bulk data instead of a single scenario. This
also means the seed deliberately does **not** toggle any feature flag
(`messaging`/`certificates`/`sponsor_reporting`) — flipping global platform
config as a side effect of seeding data broke `feature-flags.test.ts`'s
"the shared dev DB starts every flag disabled" assumption the first time
this was tried; see `docs/DEMO_DATA.md`'s "Feature flags" section for the
one-time manual step to see the student/sponsor-facing surfaces.

See `docs/DEMO_DATA.md` for the full account list, canonical course/sponsor
names, and the reset process.
