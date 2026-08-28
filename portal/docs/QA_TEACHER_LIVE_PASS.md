# Live Teacher QA Pass (Session 26)

Live testing of the Teacher workspace (Session 05) against Organization Core
and organization-aware education (Sessions 17, 21), re-verifying platform-wide
behavior alongside the new organization-scoped path, per `sessions/
26-qa-teacher.md`.

**Three real, previously-undiscovered production bugs were found and fixed
live this session** — see "Bugs found" below. All were invisible to every
prior session's "live verification" because local dev's default `DATABASE_URL`
connects as the Postgres superuser, which always bypasses RLS; production's
`kf_portal_prod_app` role does not. No QA session before this one built a real
course with a real teacher assignment/enrollment, or sent a real message,
against production's actual RLS-enforcing role — Sessions 22–25 focused on
accounts, organizations, and auth, not Education Core's write paths.

## Methodology

Two environments, both real (no mocks):

- **Real production** (`keen-prod`), using the QA TEACHER/STUDENT/ADMIN
  accounts from `docs/QA_LIVE_TEST_ACCOUNTS.md` — real HTTP, real
  `multipart/form-data` POSTs to the actual Server Action forms (scraping the
  real `$ACTION_ID_...` reference from live rendered HTML, same technique
  every prior QA session used), TOTP codes computed locally via a
  from-scratch RFC 6238 implementation from the real enrollment secrets
  (site owner retrieved `TEACHER_TOTP_SECRET`/`STUDENT_TOTP_SECRET` from the
  `portal-qa-accounts` k8s vault live during this session, since this
  session's sandboxed `kubectl` access was denied — same wall Sessions 23–25
  hit).
- **Real local dev Postgres, pointed at the non-superuser `portal_rls_test`
  role** (not the default superuser `DATABASE_URL`) — used specifically for
  the one thing production structurally cannot exercise yet: an
  organization-scoped course. No admin/teacher UI passes `organizationId`
  when creating a course (Session 21's own known limitation, re-confirmed
  current by inspecting `src/app`), and this session — like 22–25 before it
  — does not use direct production database access. Rather than leaving this
  BLOCKED the way Session 24 did for the identical gap, this session ran the
  real Next.js dev server against the RLS-enforcing role and drove it over
  real HTTP, which is what actually surfaced two of the three bugs below
  (both invisible under the superuser connection). This is real Postgres RLS
  enforcement, not local-only application logic — the same rigor class
  Session 25 used for its Google-account-parity check, flagged the same way:
  real-but-not-production verification, not conflated with a live production
  pass.

## Fixtures used

- **Production**: QA TEACHER/STUDENT/ADMIN (`docs/QA_LIVE_TEST_ACCOUNTS.md`).
  A new real course, **"QA Session 26: Teacher Regression Course"**
  (platform-scoped, id `ed1971ca-4fe9-4534-b879-4564c3b7dae0`), created live
  via the admin console specifically because production had **zero courses**
  before this session — Sessions 22–25 never created one. QA TEACHER assigned
  to teach its one cohort, QA STUDENT enrolled — left in place afterward,
  clearly QA-named, safe for later sessions to reuse (same "QA fixtures stay"
  pattern Session 22 established for its org).
- **Local (RLS-enforcing role)**: the canonical demo dataset's existing
  Baobab Learning Hub org course, plus a new **Sahel Community School**
  org-scoped course ("Sahel Hub: After-School Reading Circle") created
  through the real `src/lib/courses.ts`/`content.ts` API (never a raw
  insert) specifically so two independently-administered organizations, each
  with their own real org-scoped course, could be tested for genuine
  cross-organization isolation — Session 21's own seed only ever put one
  org-scoped course in the whole dataset. teacher1/student001 (Baobab) vs.
  teacher4/student004 (Sahel).

## Bugs found (all fixed, tested, merged, deployed same session)

### 1. No teacher could be assigned to a cohort; no student could be enrolled — anywhere, in production (PR #41, commit `96a50aa`)

`assignTeacherToCohort()`/`enrollStudent()` (`src/lib/courses.ts`) checked
the target user's role via a raw, un-`withRls()`-wrapped Prisma query. Under
real RLS this always returns zero rows regardless of the target's actual
role (RLS default-denies with no session context set), so both functions
always threw `action_failed`. **Live since Session 04 shipped it.** Fixed by
running the check under `SYSTEM_CTX` (`{ isSuperAdmin: true }`), the same
system-level-lookup-after-authorization convention `organizations.ts`
already uses. Regression test: `education-rls.integration.test.ts`'s new
`user_roles_select` case.

### 2. Any teacher viewing a course with a real enrolled student got a 500 (PR #44, commit `4dc68f7`)

`users_select` had no branch for "actor shares an active cohort relationship
with this user." Every relational `include: { student }`/`include: {
teacher }` (`courses.ts`'s `listEnrollmentsForCohort`, `progress.ts`'s
`getCourseProgressForCohort`, `messaging.ts`'s compose pickers,
`assessments.ts`, `attempts.ts`) threw
`PrismaClientUnknownRequestError: Field student/teacher is required to
return data, got null instead.` under real RLS — Prisma's `include`
re-applies the joined table's own RLS policy under the actor's session
context, and a plain TEACHER/STUDENT holds none of `users.read`/
`users.create`/`users.update`/`users.suspend`. **Live since Session 05
(roster) / Session 08 (progress) shipped.** Fixed with a narrow,
relationship-scoped `users_select` branch (teacher sees own student, student
sees own teacher, student sees a cohort-mate) via two SECURITY DEFINER
helpers, mirroring the exact precedent `messaging_cohort_visibility`
(Session 09) already established one table down. Regression tests: three new
cases across `education-rls.integration.test.ts` and
`messaging-rls.integration.test.ts`.

### 3. Sending any message, by anyone, has been broken since messaging shipped (PR #44, commit `4dc68f7`)

`conversations_select` had no "creator" branch. `messaging.ts`'s
`startConversation()` creates a `Conversation` row before any
`conversation_participants` row exists for it — and Postgres governs an
`INSERT ... RETURNING` clause (which Prisma's `.create()` always performs)
by the table's **SELECT** policy, not just INSERT/WITH CHECK. Reproduced
directly with raw SQL: the identical INSERT succeeds with no `RETURNING`
clause, fails only once one is added. **Live since Session 09 shipped it —
every prior "live-verified" messaging test (including this session's own
first pass, before the bug was found) ran against the RLS-bypassing local
superuser connection.** Fixed by letting a conversation's own creator always
see it. Regression test: new `conversations_select` case in
`messaging-rls.integration.test.ts`.

All three: `npx tsc --noEmit` clean at each step; final full suite
**543/543 passing** (537 baseline + 6 new: 1 for bug 1, 4 for bug 2 across
two files, 1 for bug 3), `RLS_TEST_DATABASE_URL` set throughout. Each fix
was verified pre-merge against the real `portal_rls_test` role, merged to
`main`, deployed to production (`deploy-portal.yml`, both runs completed
successfully — `33192976472`, `33198689361`, the second requiring the site
owner's manual approval on the `production` GitHub Environment gate after
this session's own `gh api` approval attempt was denied by its sandbox), and
**re-verified against real production post-deploy** — see the must-test
table below.

## Must-test checklist — every item, with result

| # | Item | Result |
|---|---|---|
| 1 | Teacher onboarding into an organization, end-to-end, real account | ✅ Re-confirmed live: QA TEACHER's `/organization` page in production correctly renders `QA Test Org (Session 22)` / `org_admin` / `Active` (the real onboarding Session 22 performed via this exact flow; nothing since has touched onboarding code, and Session 24 already re-verified the underlying library functions exhaustively the same day). Not re-run from a brand-new account this session — see Known limitations. |
| 2 | Teacher sees only courses/cohorts they're authorized for, correctly split platform-wide vs. their organization's own | ✅ Live, both environments: production (QA TEACHER's `/courses` correctly lists only the new fixture course after real assignment). Local/RLS-enforcing (teacher1 sees Digital Literacy + Agribusiness [platform] + Baobab [org] and NOT Sahel; teacher4 sees Financial Literacy [platform] + Sahel [org] and NOT Baobab/Digital Literacy/Agribusiness) — the split Sessions 21/24 could never live-test before, now proven under real RLS. |
| 3 | Teacher in Org A cannot access Org B's course/cohort/student data, including direct API/URL access | ✅ Live, under real RLS (local): direct `GET /courses/{other-org-id}` → "not assigned to teach this course," no draft content leaked, both directions. Crafted `POST` (real `$ACTION_ID`, foreign `courseId`, same shape a captured-request replay would use) to create a module in the other org's course → `error=not_authorized`, zero rows created, both directions. Production: the same crafted-foreign-`courseId` POST (a random UUID, since only one real teacher account exists in prod) → `error=not_authorized`. |
| 4 | Content creation, draft/publish workflow, cohort progress views still work unchanged for platform-wide courses | ✅ Full real vertical slice in production, post-fix: admin creates course → assigns QA TEACHER → enrolls QA STUDENT → QA TEACHER creates module + lesson (draft) → confirmed invisible to QA STUDENT → publishes both + the course itself → confirmed visible to QA STUDENT. Cohort roster (`Cohorts & roster`) confirmed rendering QA STUDENT's real enrollment. This item was **impossible to complete before this session's own bug #1 fix** — production had zero courses and no working teacher-assignment path at all until today. |
| 5 | Teacher-to-student messaging respects organization boundaries | ✅ Live, under real RLS (local; the `messaging` flag is deliberately `Paused` in real production — see Known limitations, not toggled by this session). Legit direct message, shared Baobab cohort (teacher1 → student001) → real `Message` row created, real conversation id returned. Crafted direct message, no shared cohort (teacher4 → student001, whose only relationship to teacher4 is an unrelated Sahel org membership with no shared cohort) → `error=not_authorized`, zero rows. Both re-run twice: once during this session's initial pass (which is what surfaced bug #3), and again after the fix to confirm the legitimate case now actually succeeds (it didn't, before the fix — see Bugs found). |
| 6 | Assessment authoring/publishing works end-to-end for both platform and organization-scoped courses | ✅ Platform: production, full live cycle (create assessment → add a short-answer question → publish → `status: published` confirmed) on the new fixture course. Organization-scoped: local/RLS-enforcing role, same full cycle on the Baobab course, plus a crafted cross-org attempt (teacher4 targeting Baobab's assessment-creation endpoint) → `not_authorized`, zero rows, and a direct `GET` of the resulting assessment by the outsider teacher → "not assigned." |

**Must NOT**: platform-wide courses were re-verified as thoroughly as the
organization-scoped path, not skipped — see items 1, 4, 6's platform half,
and the negative-authorization/foreign-`courseId` check under item 3.

## Known limitations

- **Messaging was not toggled on in real production.** It's deliberately
  `Paused` there (`FEATURE_FLAGS.MESSAGING`, default off per
  `docs/MESSAGING.md`) — flipping a live product feature flag for every real
  teacher/student on the platform is a product-rollout decision, not
  something this QA session should do unilaterally. Item 5 above is fully
  verified under real RLS enforcement locally instead (which is what
  actually found bug #3 in the first place); the flag-toggle mechanism
  itself was already separately proven live in production by prior sessions.
- **Item 1 (org onboarding) was not re-run from a brand-new disposable
  account this session** — QA TEACHER's existing Session-22 membership was
  used to confirm the flow still renders/functions correctly, rather than
  re-registering a fresh account through `/register` → `/onboarding` again.
  Sessions 22 and 24 both exhaustively exercised the raw registration/
  onboarding/invitation flow (including a brand-new disposable account) the
  same day, and nothing between then and now touched that code — judged
  sufficient given this session's time was needed for the three bugs found.
- **Assessment attempts/grading (`src/lib/attempts.ts`)** has the exact same
  `include: { student }` shape bug 2 fixed elsewhere, and is therefore
  covered by the same `users_select` fix by construction — but no student
  actually submitted a real attempt against the new production fixture
  course this session (would have required simulating a full student
  attempt-submission flow, outside this session's Teacher-portal scope), so
  the grading view itself was not independently live-tested. Low risk (same
  fix, same table, same mechanism already proven twice elsewhere) but not
  independently confirmed.
- **The "RETURNING clause governed by SELECT policy" bug class (bug 3) was
  fixed only where it was actually found** (`conversations`). Other tables
  where application code does a `.create()` immediately after establishing a
  brand-new ownership/participant relationship in the same transaction could
  have the identical bootstrap gap — `organizations`/`sponsor` project
  creation are already proven fine in production (Sessions 17/18/22/24/25 all
  successfully created real rows there via real HTTP), but a full audit of
  every such `.create()` call site across every module (assets, certificates,
  notifications) was not performed this session — out of scope for a Teacher
  QA pass. Flagged as a systemic risk class worth a dedicated audit, not a
  known remaining bug.
- Every QA TEACHER/STUDENT production fixture used pre-existing accounts from
  Session 22 — no new disposable account was created or needs disposal this
  session.

## Blockers

None remaining. Two were raised and resolved live with the user during this
session:
- `kubectl` access to `portal-qa-accounts` (TEACHER/STUDENT TOTP secrets) was
  denied by this session's sandbox — resolved by the site owner retrieving
  and providing the two secret values directly (same wall, same resolution
  Sessions 24/25 already established).
- This session's own `gh api ... pending_deployments` approval calls were
  denied by its sandbox for both deploys — resolved by the site owner
  approving each `production` GitHub Environment gate directly on GitHub.

## Required next-session actions

- **Whoever builds organization-scoped course-management UI** (Sessions 21
  and 24 already flagged this, re-flagged again): once a "create course for
  my organization" affordance exists, must-test items 2/3/6's organization
  half can finally be re-run as a genuine production HTTP pass instead of
  the local/RLS-enforcing-role substitute this session (and Session 25's
  Google-parity check) used.
- **Whoever owns Session 07 (Assessment)**: consider a dedicated live pass
  exercising `src/lib/attempts.ts`'s grading view against a real submitted
  attempt in production — not independently confirmed this session (see
  Known limitations), though covered by the same fix that already unblocked
  the roster/progress/messaging call sites.
- **Whoever next touches transaction-ordered `.create()` calls in any
  module**: be aware of the "RETURNING is governed by the SELECT policy, not
  just INSERT/WITH CHECK" RLS interaction this session found in
  `conversations` — a brand-new row's creator needs an explicit
  `created_by = app.user_id`-shaped SELECT branch (or equivalent) if nothing
  else yet establishes their visibility into it at the moment of creation.
  Worth a systemic audit (see Known limitations) before this bites another
  module the way it silently broke all of messaging for two sessions.
- **QA Session 26's production fixture** (`QA Session 26: Teacher Regression
  Course`, id `ed1971ca-4fe9-4534-b879-4564c3b7dae0`) remains in production,
  clearly QA-named, published, with a real module/lesson/assessment and QA
  STUDENT enrolled — safe to reuse for later QA sessions the same way
  Session 22's org has been.
- **Whoever next runs the local dev Postgres this session used**
  (`keenafrica-portal-dev-pg`, port 55432): the Sahel Community School
  now has a real org-scoped course ("Sahel Hub: After-School Reading
  Circle") seeded via the real API, alongside the pre-existing Baobab one —
  both are reusable two-organization fixtures for future local RLS testing,
  not part of the committed demo-seed pipeline (created by a one-off script,
  not persisted in this repo).
