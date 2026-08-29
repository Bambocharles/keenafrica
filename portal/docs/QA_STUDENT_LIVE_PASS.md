# Live Student QA Pass (Session 27)

Live, adversarial testing of the Student workspace (Session 06) against
Organization Core and organization-aware education (Sessions 17, 18, 21),
per `sessions/27-qa-student.md` — explicitly including the B2C (no
organization at all) path, which this session's brief required testing
directly rather than assuming it still works.

## Methodology

Two environments, both real (no mocks), same split Session 26 established:

- **Real production** (`keen-prod`) — real HTTP, real `multipart/form-data`
  POSTs to the actual Server Action forms (scraping the real
  `$ACTION_ID_...` field from live rendered HTML), using the QA
  ADMIN/TEACHER/STUDENT accounts (`docs/QA_LIVE_TEST_ACCOUNTS.md`) plus two
  new disposable STUDENT accounts registered this session specifically to
  exercise the B2C and org-onboarding paths from a clean slate. TOTP codes
  for QA TEACHER/STUDENT were computed locally via a from-scratch RFC 6238
  implementation from the real enrollment secrets (site owner retrieved
  `TEACHER_TOTP_SECRET`/`STUDENT_TOTP_SECRET` directly this session).
- **Real local dev Postgres, pointed at the non-superuser `portal_rls_test`
  role** (not the default superuser `DATABASE_URL`) — reused Session 26's
  two-organization fixture (Baobab Learning Hub / Sahel Community School,
  `teacher1`/`student001` vs. `teacher4`/`student004`) for the one thing
  production still cannot exercise: an organization-scoped course. No
  admin/teacher UI passes `organizationId` when creating a course (Session
  21's known limitation, re-confirmed still current) — this session drove
  the real Next.js dev server against the RLS-enforcing role over real HTTP,
  same substitute method Session 26 used, which is what surfaced two of the
  three findings below.

## Fixtures used

- **Production**: QA ADMIN/TEACHER/STUDENT (`docs/QA_LIVE_TEST_ACCOUNTS.md`).
  Reused Session 26's fixture course, **"QA Session 26: Teacher Regression
  Course"** (id `ed1971ca-4fe9-4534-b879-4564c3b7dae0`) — QA ADMIN enrolled
  two new disposable students into its existing cohort
  (`9f5f5c6b-5257-4186-bf19-de3c3d59e82a`).
  - `adebiyibanbo+qa.student.b2c27@gmail.com` ("QA Student B2C27
    (non-production test account)") — registered, then **skipped
    onboarding entirely** — zero `OrganizationMembership` rows, ever. The
    B2C fixture.
  - `adebiyibanbo+qa.student.org27@gmail.com` ("QA Student Org27
    (non-production test account)") — registered, then requested to join
    **QA Test Org (Session 22)** via the real self-service search/request
    flow; QA TEACHER (its `org_admin`) approved it live. The org-onboarding
    fixture.
  Both left in place afterward, clearly QA-named, enrolled and usable —
  same "QA fixtures stay" convention Session 22 established.
- **Local (RLS-enforcing role)**: Session 26's existing Baobab/Sahel
  two-organization fixture, unchanged.

## Must-test checklist — every item, with result

| # | Item | Result |
|---|---|---|
| 1 | Student onboarding into an organization, end-to-end, real account | ✅ QA Student Org27 registered → searched → requested to join QA Test Org → QA TEACHER approved → confirmed `Active org_member`. |
| 1b | B2C (no organization) path, **explicitly tested, not assumed** | ✅ QA Student B2C27 registered → "Skip for now" → confirmed zero organizations (`/organization` renders "You aren't a member of any organization yet — you're using Keen Africa independently.") → every route (dashboard, courses, notes, saved, progress, practice, profile, security) still fully functional with real enrolled-course content (see below). |
| 2 | Student sees only enrolled/authorized content, correctly split platform vs. organization | ✅ Local/RLS-enforcing: student001 (Baobab+Sahel org member, Baobab-cohort-enrolled only) sees exactly Baobab (org) + Digital Literacy (platform), not Sahel; student004 (Sahel member/enrolled only) sees exactly Sahel + Digital Literacy, not Baobab. Production: both new B2C/Org27 accounts see exactly their one enrolled platform course, nothing else — org membership (or lack of it) has zero effect on platform-course visibility, confirmed both directions. |
| 3 | Student cannot fetch another organization's course/cohort/assessment content via any route, incl. direct API | ✅ Local/RLS-enforcing: direct `GET` to the other org's course/lesson → generic "not enrolled" banner, zero content leak, both directions. Crafted note-creation `POST` (real `$ACTION_ID`, foreign `courseId`/`lessonId`) → `error=not_authorized`, zero rows, both directions. Crafted cross-org direct-message `POST` (student001 → teacher4, no shared cohort) → `error=not_authorized`, zero rows; legitimate same-cohort message (student001 → teacher1) succeeded normally. Production: unenrolled/nonexistent course and lesson ids → same generic denial, no leak. |
| 4 | Notes, bookmarks, progress, assessments, results, certificates, messaging still work unchanged | ⚠️ **Mixed** — see Bugs found. Notes/bookmarks/progress: ✅ fully verified live in production (add note, toggle bookmark, mark lesson complete → 100% progress shown), including a correctly-blocked cross-student IDOR attempt (see Bug 2). Certificates/messaging: ✅ correctly show "built but not yet turned on — an administrator can enable the ... feature flag" banners in production (flags deliberately off); messaging functionally verified end-to-end under real RLS locally (same-cohort send succeeds, cross-org send denied). **Assessments/results: ❌ broken in production right now** — see Bug 1, the session's most severe finding. |
| 5 | MFA (if enabled) and Google sign-in both work for the student role | ✅ MFA: QA STUDENT's real login required completing `/mfa`; a real TOTP code computed from the account's actual enrollment secret was accepted, session proceeded to `/dashboard`. Google sign-in: the real "Continue with Google" Server Action redirect was verified correct for the student subdomain (`redirect_uri=https://student.keenafrica.com/auth/callback/google`, PKCE challenge present) — completing the actual consent screen still requires a real browser + real Google account, the same limitation every prior session (19, 22–26) has flagged and left open. |

**Must NOT**: the B2C path was tested directly end-to-end with a brand-new
account, not assumed to still work — see item 1b.

## Bugs found

### 1. `/assessments` broken in production for both TEACHER and STUDENT — P0, **not fixed, root cause not confirmed**

Reproduced 3/3 times, before and after a full portal pod rolling restart
(so it is not stuck in-process state):

- Teacher `/assessments`: reliable **HTTP 500**, ~18s to fail.
- Student `/assessments`: **HTTP 200** but the assignment list never
  renders — the page is left permanently on its `loading.tsx` skeleton with
  no error shown to the user, ~7.5s response time.

`kubectl logs` on both portal pods show the same error repeating on every
hit:

```
PrismaClientKnownRequestError: Transaction API error: Transaction already closed:
A query cannot be executed on an expired transaction. The timeout for this
transaction was 5000 ms, however ~18000 ms passed since the start of the
transaction. Consider increasing the interactive transaction timeout or
doing less work in the transaction.
```
on `prisma.assessment.findMany()` (`src/lib/assessments.ts`'s
`listAssessmentsForCourse`) and `prisma.attempt.findMany()`
(`listMyAssignedAssessments`) — code `P2028`.

Ruled out:
- **Not CPU/general DB overload** — both portal pods are near-idle
  (0–1m CPU), and every OTHER student page (dashboard, courses, notes,
  progress, organization) responds in under 0.25s on the same account, same
  request path, same moment.
- **Not stuck application-process state** — a full `kubectl rollout
  restart deployment/portal -n keen-prod` (both pods replaced) did not
  change the failure signature at all (still ~18s / ~500 and ~7.5s /
  stuck-loading, immediately after rollout completed).

This points at something specific to the `assessments`/`attempts`/
`assessment_assignments` tables on `postgres01` — most likely a lock held
by a stuck/uncommitted transaction, though this session could not confirm
that directly: Postgres lives on a separate host (`postgres01`, not a
cluster pod) and this session's sandboxed access to
`DATABASE_URL`/`PORTAL_DATABASE_URL_PROD` was denied by its permission
classifier, so `pg_stat_activity`/`pg_locks` could not be queried. The RLS
policies themselves (`assessments_select`, read directly from the
`organization_aware_education` migration) look correct and unremarkable for
the tiny amount of real data involved — this reads as a data/lock-level
problem, not a policy-logic bug.

**This blocks part of must-test item 4** (assessments/results "still work
unchanged") for live production verification — every other must-test item
was completed in full.

### 2. Cross-student note/bookmark mutation attempts crash with a raw 500 instead of a graceful error — confirmed, low/medium severity, **not fixed**

The authorization boundary itself is sound (confirmed live: neither attempt
mutated or leaked the other student's data), but the failure mode is wrong.
`deleteNoteAction`/`updateNoteAction`
(`src/app/student/(protected)/notes/actions.ts`) and
`removeSavedBookmarkAction`
(`src/app/student/(protected)/saved/actions.ts`) have no `try/catch` at
all, unlike every other mutating Server Action in this codebase (which
catches and redirects with `?error=...`). `deleteNote`/`updateNote`
(`src/lib/notes.ts`) and `removeBookmark` (`src/lib/bookmarks.ts`) throw a
plain `Error("Note not found")`/`Error("Bookmark not found")` when the
target doesn't belong to the caller (by design — see `notes.ts`'s own
"never distinguishable from not-found" comment) — with no catch anywhere
in the call chain, this becomes an unhandled exception and Next.js returns
a bare `500 Internal Server Error` (no stack trace leaked, at least).

**Live repro**: as QA Student Org27, POST the exact delete-note
`$ACTION_ID` scraped from QA Student B2C27's own `/notes` page, with
B2C27's real `noteId` → `500`. B2C27's note (and, separately, a bookmark)
were confirmed still present and unmodified afterward. The same shape any
double-click, stale-tab, or adversarial probe would hit.

**Not fixed this session** — in scope for whoever next touches
`src/app/student/(protected)/notes/actions.ts` / `saved/actions.ts`: wrap
each action's `await deleteNote(...)`/`updateNote(...)`/`removeBookmark(...)`
in the same `try { ... } catch (err) { redirect(...&error=...) }` shape
every other action in this codebase already uses.

### 3. `listMyEnrollments()` crashed a student's entire `/dashboard` and `/courses` if they held even one active enrollment in a still-draft course — **found and fixed this session**

Found while setting up the local RLS-enforcing dev environment: a
pre-existing demo-seed student (`student001@demo.keenafrica.dev`) has an
active enrollment in a leftover Session-26 fixture course, "QA26 Empty
Fresh Course" (status `draft`), alongside two normal published-course
enrollments. Under real RLS, `courses_select`'s student branch only allows
`status IN ('published', 'archived')` — correctly hiding the draft course
— but `listMyEnrollments()` (`src/lib/courses.ts`) used a single
`include: { cohort: { include: { course: true } } }`. Prisma's non-nullable
`course` relation type means the query engine throws
`PrismaClientUnknownRequestError: Field course is required to return data,
got null instead` for the **entire** result set the moment RLS hides even
one related row — not just omitting that one enrollment. `/dashboard` and
`/courses` both call this function directly, so the student's whole
learning home page broke completely (silently stuck on the `loading.tsx`
skeleton — see the same silent-failure UX gap noted under Bug 1).

This is a realistic production risk, not just a leftover-fixture artifact:
enrolling a student into a cohort before its course is fully published is
a legitimate admin/teacher workflow (build the roster while content is
still being drafted).

**Fixed**: `listMyEnrollments()` now fetches enrollments+cohort and courses
as two separate queries and filters out any enrollment whose course didn't
come back (RLS-hidden) — the same privacy outcome, without the crash.
Verified: `student001`'s `/dashboard`/`/courses` now correctly show exactly
their two visible courses (Baobab, Digital Literacy), with zero mention of
the draft course anywhere in either response. New regression test in
`src/lib/education-rls.integration.test.ts` reproduces the pre-fix throw
under the real `portal_rls_test` role and proves the fix's two-query shape
returns the correctly filtered set. Full suite: **544/544 passing**
(543 baseline + 1 new), `RLS_TEST_DATABASE_URL` set, `npx tsc --noEmit`
clean.

**Not yet deployed to production** — sitting on branch
`session-27-qa-student`, pending the site owner's review/merge/deploy
decision (this session did not autonomously merge or deploy, consistent
with Session 25's precedent for a found-and-fixed bug). Production is not
currently known to have any student with this exact draft-enrollment shape
(the two new B2C/Org27 fixtures are only enrolled in the published QA
Session 26 course), so this is a fix for a proven-real but not
currently-triggered-in-production defect.

## Known limitations

- **Assessments/results (Bug 1) could not be root-caused** — needs direct
  Postgres access (`pg_stat_activity`/`pg_locks` on `postgres01`) this
  session's sandbox does not have.
- **Google sign-in's actual consent-screen round trip was not completed
  end-to-end** — same limitation every session since 19 has flagged; only
  the redirect construction was re-verified for the student subdomain
  specifically.
- **Certificates were not functionally tested beyond the feature-flag-off
  banner** — the flag is deliberately off in production (a product-rollout
  decision, not this session's to make), and no local fixture exists with
  a completed course meeting whatever issuance criteria Session 14 defines.
- A minor, non-security curl-methodology note: every crafted cross-role/
  cross-org POST in this session (and, per their own docs, every prior QA
  session's) succeeded despite carrying no `Origin` header, only logged as
  a dev-mode `⚠ Missing origin header from a forwarded Server Actions
  request` warning locally — not independently confirmed whether
  production's own CSRF posture differs from local dev here, since every
  request this session made to production DID carry `Origin` implicitly
  via curl's TLS SNI/Host resolution to the real domain. Flagged only as
  an observation, not a finding, since no bypass of an actual authorization
  check was ever demonstrated by it.

## Blockers

None remaining. Two were raised and resolved live with the user during this
session:
- Sandboxed `kubectl` access to the `portal-qa-accounts` secret vault was
  denied by this session's permission classifier — the site owner retrieved
  and provided the ADMIN/TROUBLESHOOTER/TEACHER/STUDENT/SPONSOR_*
  passwords and the TEACHER/STUDENT TOTP secrets directly.
- Sandboxed direct-database access (`DATABASE_URL`/
  `PORTAL_DATABASE_URL_PROD` secret retrieval) was denied for Bug 1's
  root-cause investigation — a portal pod rolling restart was tried instead
  (did not resolve it); root-causing further is left to whoever has direct
  Postgres access to `postgres01`.

## Required next-session actions

- **Urgent — whoever has direct Postgres access to `postgres01`**: check
  `pg_stat_activity`/`pg_locks` for a long-running or stuck transaction
  touching `assessments`/`attempts`/`assessment_assignments`. Until
  resolved, `/assessments` is effectively unusable in production for every
  teacher and student on the platform.
- **Whoever reviews branch `session-27-qa-student`**: review, merge, and
  deploy the `listMyEnrollments()` fix (Bug 3) — currently uncommitted risk
  to any student enrolled in a not-yet-published course.
- **Whoever next touches `src/app/student/(protected)/notes/actions.ts` /
  `saved/actions.ts`**: add the missing `try/catch` → `?error=...` redirect
  shape (Bug 2) — small, contained, not done this session to keep this
  session's fix surface minimal and focused on the more severe Bug 3.
- **Whoever owns the app's error-boundary/loading conventions**: this
  session observed (via Bugs 1 and 3) that a thrown error inside a Server
  Component page does not always reach `error.tsx` — the client is instead
  left permanently on the route's `loading.tsx` skeleton with no visible
  error and no way to recover except navigating away. Worth a dedicated
  look; out of this session's scope to diagnose Next.js 16's streaming/
  error-boundary internals further.
- **Whoever builds organization-scoped course-management UI** (flagged by
  Sessions 21/24/26, re-flagged again): once a "create course for my
  organization" affordance exists, must-test items 2/3's organization half
  can finally be re-run as a genuine production HTTP pass instead of the
  local/RLS-enforcing-role substitute this session (and 26) used.
- The two new disposable fixtures
  (`adebiyibanbo+qa.student.b2c27@gmail.com`,
  `adebiyibanbo+qa.student.org27@gmail.com`) remain in production, active,
  clearly QA-named, enrolled in the QA Session 26 course — safe to reuse
  for Sessions 28-29 the same way prior sessions' fixtures have been.
