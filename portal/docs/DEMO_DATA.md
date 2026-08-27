# Demo & Test Environment (Session 15)

The canonical demo/test universe for development and staging, per
`testing/demo-data.md`. Disposable and resettable — never something
production runs (see "Production protection" below).

## Seeding it

```bash
ALLOW_DEMO_SEED=true npm run seed:demo
```

Requires `NODE_ENV !== production` (see `prisma/seed/guard.ts`). Runs the
core tasks (roles/permissions/super-admin/feature-flags) first, then the
demo task. Refuses to run a second time on top of already-present demo
data — use the reset process below instead.

## Resetting it

```bash
ALLOW_DEMO_SEED=true npm run demo:reset
```

Wipes every row the demo seed is known to have created, then recreates the
exact same baseline from scratch. Deterministic: courses, cohorts,
sponsors/projects, and every account's email are the same stable
names/addresses on every run — screenshots, QA scripts, and documentation
referencing them stay valid across a reset. Gated by the same guard as
`seed:demo` (see "Production protection").

## Accounts

Every demo account's email ends in `@demo.keenafrica.dev` and shares one
password: **`DemoPass123!`**. This is what makes the domain a safe,
grep-able marker for "this is demo/test data," per
CLAUDE_BUILD_RULES.md §10/PLATFORM_CONTEXT.md's "clearly synthetic
credentials" requirement.

| Role | Count | Example email |
|---|---|---|
| Super admin | 1 | `superadmin@demo.keenafrica.dev` |
| Admin | 2 | `admin1@demo.keenafrica.dev`, `admin2@demo.keenafrica.dev` |
| Troubleshooter | 2 | `troubleshooter1@demo.keenafrica.dev` |
| Teacher | 5 | `teacher1@demo.keenafrica.dev` … `teacher5@demo.keenafrica.dev` |
| Student | 100 | `student001@demo.keenafrica.dev` … `student100@demo.keenafrica.dev` |
| Sponsor admin/user | 5 | `sponsor1-admin@demo.keenafrica.dev`, `sponsor1-user@demo.keenafrica.dev`, … |

This is a **separate** super-admin account from whatever real one
`SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` may have bootstrapped
(`prisma/seed/tasks/super-admin.ts`) — that one is a real operator
credential; this one is a synthetic account safe to hand to anyone
exploring the demo environment.

## Courses, cohorts, and student distribution

Three stable courses, each with 2 modules / 4 published lessons / 1
resource per lesson / 2 topics / a published, cohort-assigned assessment
(4 questions: 2 single-choice, 1 multiple-choice, 1 short-answer):

- **Digital Literacy Fundamentals** — 2 cohorts (`2026 Cohort A`,
  `2026 Cohort B`; Cohort B has two teachers, satisfying the
  "at least one multi-teacher cohort" requirement). Its assessment's
  short-answer question has no `acceptableAnswers`, so some attempts land
  in `submitted` (pending manual grade) until a teacher grades them —
  the one course that exercises `gradeAttempt()`.
- **Financial Literacy for Entrepreneurs** — 1 cohort. Auto-graded
  short-answer question.
- **Agribusiness Essentials** — 2 cohorts. Auto-graded short-answer
  question.

Every cohort holds the same 20-student distribution (5 cohorts × 20 =
100 students total, matching `testing/demo-data.md`'s 20/25/20/15/10/10
split exactly):

| State | Per cohort | Total | What it means |
|---|---|---|---|
| Not started | 4 | 20 | Enrolled, zero lesson completions |
| Active | 5 | 25 | 1 of 4 lessons complete |
| Halfway | 4 | 20 | 2 of 4 lessons complete; one per cohort has an `in_progress` (never submitted) assessment attempt |
| Nearly complete | 3 | 15 | 3 of 4 lessons complete; up to two per cohort have attempted the assessment |
| Completed | 2 | 10 | All lessons complete → `Enrollment.status = completed` → a `Certificate` is issued for real, through `issueCertificateIfEligible()` |
| Inactive | 2 | 10 | 1 lesson complete, then withdrawn (`Enrollment.status = withdrawn`) — distinct from "not started" |

Two students (one from an even-numbered cohort's inactive slot) additionally
have their **User account suspended** (`status = suspended`), demonstrating
that state independently of enrollment status.

Assessment scores are real, computed by the platform's own auto-grading —
25%, 50%, 75%, and 100% all appear, spanning both sides of the 70% passing
threshold.

## Messaging, notes, bookmarks, sponsor data

- Every cohort has one teacher broadcast (`cohort_broadcast` conversation)
  and two direct student↔teacher threads (one read, one with an unread
  teacher reply, plus one thread the teacher hasn't answered at all), plus
  one admin→student direct message (`messages.admin`).
- A sample "active"/"halfway"/"nearly-complete"/"completed" student per
  cohort has a `StudentNote` and a `Bookmark`.
- Notifications arrive automatically from these actions via the platform's
  own domain-event listeners (Session 10) — roughly half of every user's
  notifications are then marked read, for a real unread/read mix.
- 3 sponsors (**Baobab Impact Foundation**, **Sahel Youth Trust**, **Nile
  Skills Alliance**), 4 projects across them, milestones in every status
  (`planned`/`in_progress`/`achieved`/`missed`), a metric time series per
  project, one document per project, and student beneficiaries linked via
  `ProjectMembership` — sponsor users only see their own sponsor's
  project(s), enforced by the real ownership checks in `src/lib/sponsor.ts`
  (verified live — see the Session 15 handoff in
  `status/project-status.md`).

## Organizations (Session 17)

2 organizations, seeded entirely through the real `src/lib/organizations.ts`
API (never raw inserts) — reuses existing demo teacher/student accounts as
members rather than inventing new ones:

- **Baobab Learning Hub** (`training_center`) — `teacher1` is its founding
  `org_admin`; `teacher2` was invited as a known existing user and accepted
  (`org_member`, active); `student001` requested to join and was approved
  (active); `student002` requested to join and is still **pending**
  (deliberately left unapproved — a realistic in-flight state); `student003`
  was approved then **suspended**.
- **Sahel Community School** (`school`) — `teacher4` is its founding
  `org_admin`; `student001` (the same student as above — proves multi-org
  membership) and `student004` are active `org_member`s.

See `docs/ORGANIZATION_CORE.md` for the full contract these exercise.

## Feature flags

The demo seed deliberately does **not** toggle any feature flag. All the
data above exists and is fully visible in the admin console regardless; the
`messaging`, `certificates`, and `sponsor_reporting` flags gate only the
*student/sponsor-facing* surfaces for those features and seed `off` by
default (`prisma/seed/tasks/feature-flags.ts`). Flip them at
`/admin/flags` (any seeded admin/super-admin account) to see certificates
on `/student/certificates`, messaging on `/student/messages`, etc. This is
a one-time manual step per environment, not something `demo:reset` should
automate — see `docs/SEED_FRAMEWORK.md`'s "What Session 15 built" for why
(flipping global config from a seed script broke an unrelated test's
"shared dev DB starts with every flag off" assumption the first time this
was tried).

## Production protection

Both `seed:demo` and `demo:reset` share `prisma/seed/guard.ts`'s
`assertDemoSeedAllowed()`: they throw immediately unless `NODE_ENV` is not
`production` **and** `ALLOW_DEMO_SEED=true` is set explicitly. There is no
separate, weaker gate for the reset half — wiping demo data requires
exactly the same two conditions as creating it. Production also never sets
`ALLOW_DEMO_SEED`, uses its own separate database/secrets (see
`docs/ENVIRONMENT.md`), and would reject any `@demo.keenafrica.dev` login
the same as any other unrecognized credential — there is no code path that
treats that domain as special/trusted.

## Known limitations

- The reset process identifies demo rows by stable name/email-domain
  constants (`tasks/demo/constants.ts`), not a dedicated "is demo" column —
  no schema change was needed, but a real course/sponsor an admin creates
  in the same dev database with an identical title/name to one of the
  three canonical demo courses or three canonical sponsors would be swept
  up by `demo:reset`. Not a concern in the shared local dev DB this was
  built and verified against; worth a dedicated column if this environment
  ever hosts real, non-disposable content alongside the demo universe.
- `demo:reset` does not reset feature flags (see "Feature flags" above) —
  an admin's manual flag flips persist across a reset, by design (global
  config is not "demo data").
- No teacher/admin ever explicitly retakes/re-grades an attempt more than
  once, and no student has more than one certificate — the dataset covers
  every *state* `testing/demo-data.md` asks for, not every possible
  transition between them.
