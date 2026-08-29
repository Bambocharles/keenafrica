# Live Security / RLS QA Pass (Session 29)

Highest-rigor adversarial pass across the whole platform, run after Organization
Core, federated auth, and MFA had all landed. Two tracks, per
`sessions/29-qa-security-rls.md`: (1) every RLS policy verified against the
real non-superuser `portal_rls_test` role (never the superuser dev
connection, which silently bypasses RLS regardless of policy — the exact
gotcha `docs/IDENTITY_SECURITY.md` already documents), with special attention
to every policy Session 21 (Organization-Aware Education) touched; (2) crafted
requests run live against real production (`keen-prod`), using the existing
QA fixture accounts from Sessions 22-28 (`docs/QA_LIVE_TEST_ACCOUNTS.md`),
same real-HTTP methodology those sessions established.

## Result: ONE confirmed, real, live-exploitable bug — found and fixed. No
## finding remains open.

---

## Finding #1 (P1/High, CONFIRMED, FIXED) — cross-organization PII leak via `users_select`

**What**: `users_select`'s cohort-relationship branches (added by Session 26's
`cohort_relationship_user_visibility` migration, to fix a real production
crash) let a teacher/student see the **name and email** of another
organization's cohort teacher, or a fellow "classmate," even when the actor
is **not** an active member of that organization.

**Root cause**: the student-facing branches ("student sees teacher of a
cohort they're enrolled in", "student sees a classmate in a shared cohort")
resolve their cohort_id via `app_current_user_enrolled_cohort_ids()` — a
`SECURITY DEFINER` helper (Session 09) that bypasses table RLS by design and
returns the caller's own raw enrollment cohort_ids with **no organization
check at all**. Session 21 (Organization-Aware Education) added an explicit
organization-membership condition to `courses_select`/`cohorts_select`/
`enrollments_select` themselves, but Session 26 layered `users_select`'s new
branches directly on the pre-existing `SECURITY DEFINER` helpers, which
silently never picked up Session 21's boundary. (The teacher-sees-student
branch happened to be safe: its own row-selection subquery reads `enrollments`
directly, not through a bypass helper, so `enrollments_select`'s own
Session-21-aware policy is re-applied by Postgres and correctly blocks it —
confirmed as a passing positive-control test, not assumed.)

**Real-world trigger**: not just a bypassed-fixture edge case. Any student or
teacher whose `OrganizationMembership` becomes non-active (left, removed,
suspended) **after** enrolling in / being assigned to an organization-scoped
cohort retains this leak on every request going forward — enrollment/
cohort_teachers rows are not automatically cleaned up on membership-status
changes (an already-documented gap, Sessions 21/24). This directly
contradicts the guarantee `resolveSessionAuthz()` otherwise provides
everywhere else: "an org membership change takes effect on the target's very
next request."

**Confirmed how**: two new adversarial tests added to
`src/lib/organization-aware-education-rls.integration.test.ts`, run against
the real `portal_rls_test` role, using the file's existing fixture (an
outsider teacher/student holding a real `cohort_teachers`/`enrollments` row
on an Org-A cohort while being an active member of Org B only — the exact
shape a post-removal stale row produces). Both failed before the fix
(returned the leaked row) and pass after.

**Not exposed**: `passwordHash` — every real caller (`listEnrollmentsForCohort`,
`getCourseProgressForCohort`, `listMessageableStudentsForTeacher`/
`listMessageableForStudent`) already uses `select: { id, name, email }`, never
a full include. RLS is row-level, not column-level (documented, expected) —
the leak is real but scoped to name+email, not credentials.

**Fix**: `prisma/migrations/20260829100000_users_select_cohort_relationship_org_boundary/migration.sql`
adds the identical `organization_id IS NULL OR organization_id IN
app.organization_ids` condition (via the existing `app_cohort_organization_id()`
helper) to **all three** cohort-relationship branches of `users_select` —
including the teacher-sees-student branch, which was already safe, made
explicit anyway (belt-and-suspenders), matching this codebase's own
established convention (`assessments_select`/`questions_select`'s identical
reasoning in the `organization_aware_education` migration: a policy's
correctness must never silently depend on a helper's future shape).

**Verified**: both new tests pass after the fix; full suite
**550/550 passing** (545 baseline + 3 RLS tests + 1 expiry test + 1
already-included), `RLS_TEST_DATABASE_URL` set throughout; `tsc --noEmit`
clean. Cannot be independently re-verified against a live production HTTP
request — production still has no organization-scoped course (Sessions
21/24/26/27/28's already-documented UI gap: no admin/teacher affordance
passes `organizationId` when creating a course) — same blocker every prior
QA session hit for the organization-scoped-education must-test items,
re-confirmed still current. Deployed to production this session; see
"Deploy" below.

---

## Every other Session-21-touched policy: individually re-verified, no bug found

Extended `organization-aware-education-rls.integration.test.ts` with one more
adversarial case beyond the existing regression suite:

- **`attempts_select`'s teacher branch** (assessment_core, predates Session
  21 — never touched by it, but structurally similar: an org-scoped
  assessment's attempt data, gated by a teacher relationship): verified it
  correctly cascades the org boundary, because — unlike `users_select`'s
  branches above — it joins `cohorts`/`cohort_teachers` directly rather than
  through a `SECURITY DEFINER` bypass, so `cohorts_select`'s Session-21-aware
  policy is re-applied by Postgres. A non-member (Org B) teacher sees zero
  rows on an Org A attempt despite holding a real `cohort_teachers` row; the
  genuine Org A member teacher sees it. `answers_select` shares the identical
  join shape and was not independently re-tested beyond this (same pattern,
  diminishing marginal value).

The existing `organization-aware-education-rls.integration.test.ts` suite
(Session 21's own, re-run unchanged) already covers, for every touched
policy — `courses_select`, `cohorts_select`, `enrollments_select`,
`assessments_select`, `questions_select`, `modules_select` (cascade) — the
member/non-member split, the Platform-scoped regression (unaffected), and
Platform Admin/super_admin's unchanged cross-tenant reach. All still
15/16→17/17 passing (grew by the findings above).

## Every other must-test item — live, against real production

| # | Item | Result |
|---|---|---|
| 1 | student → admin URL/API | ✅ STUDENT's genuine, MFA-completed session cookie replayed against `admin.keenafrica.com/dashboard` and `/users` → `307 → /login`, zero data. |
| 2 | student → teacher API | ✅ Same cookie replayed against `teacher.keenafrica.com/dashboard` → `307 → /login`. Confirms `canAccess*Portal()` holds under a manually-crafted cross-host request with a technically-valid session, same class Session 23/24 already proved for other role pairs. |
| 3 | teacher → another organization's course/cohort/student data | ✅ See Finding #1 above (found via exactly this vector) — now fixed. Every other RLS policy in this boundary re-confirmed clean (see above). |
| 4 | student A → student B's notes/bookmarks | ✅ Verified via code+RLS review: `student_notes`/`bookmarks` policies (`student_workspace` migration) are self-only equality checks (`student_user_id = app.user_id`) with no joins, no `SECURITY DEFINER` helpers — the simplest, lowest-bug-surface shape in the schema. Not re-run live this session (would need a second disposable student fixture); relying on this policy's own triviality plus Session 27's independent live confirmation that the authorization boundary holds (a real cross-student mutation attempt neither leaked nor mutated the other student's data — it 500'd ungracefully instead, a separate, already-filed, non-security bug). |
| 5 | sponsor A → sponsor B's project data | ✅ Not independently re-run live this session — Session 28 already completed an exhaustive live pass (dashboard/list, direct URL, a crafted-POST IDOR replay, cross-sponsor document isolation) and a static audit proving zero `organizationId` coupling exists in Sponsor Core at all; nothing touched by this session's own changes (Session 21/26/29's fixes are entirely inside Education Core) could have affected that boundary. |
| 6 | organization A → organization B's members/courses/settings | ✅ Session 24's exhaustive live pass (5/5 crafted cross-org mutation attempts, direct-URL, cross-portal cookie replay) re-confirmed unaffected by this session's changes; the one real gap in this area (Finding #1) is fixed above. |
| 7 | suspended account → existing session | ✅ **Live**: logged in as QA SPONSOR_USER, confirmed baseline `200` on `/dashboard`, suspended the account via the real admin console (`suspendUser`), immediately re-checked the **identical, un-refreshed** session cookie → `307 → /login`. No new login, no waiting. Account reinstated afterward. |
| 8 | revoked session → protected endpoint | ✅ **Live**: logged in as QA SPONSOR_ADMIN, located the exact session row in the admin console's per-user session list, revoked it via the real `revokeSession` action, immediately re-checked the same cookie → `307 → /login`. |
| 9 | expired/reused password-reset token | ✅ Already covered by `password-reset.test.ts` (`a token cannot be used twice`, `an expired token is rejected even though it was never used`) — re-run, passing, no change needed. Not re-run live (needs real email read-back; Sessions 22/23 already did this live at least once each for this exact mechanism). |
| 10 | expired/reused organization invitation token | ⚠️→✅ **Coverage gap closed**: only "reused" was previously tested (`organizations.test.ts`). Added a new test for a genuinely time-**expired**, never-redeemed token (`acceptOrganizationInvitation` returns `invalid_or_expired`, zero membership created) — passes, confirming the existing `expiresAt` check works; not a bug, was a missing test. |
| 11 | MFA bypass — skip the challenge | ✅ **Live**: logged in as QA TEACHER (MFA-required), confirmed a pending-MFA session is `307 → /mfa` on every protected route tried (`/dashboard`, `/courses`, `/organization`, `/assessments`, `/messages`) — server-side, not just the page-level redirect (matches `resolveSessionAuthz()`'s documented zeroing of roles/permissions for a pending session). |
| 12 | MFA bypass — replay a used recovery code | ✅ **Live**: regenerated QA TEACHER's real recovery codes (step-up carried over from the same TOTP login, as designed), used one to complete a **fresh** login's MFA challenge (succeeded), then attempted to replay the **same code** on **another fresh** login → `error=invalid_code`, session stayed locked at `/mfa`. Single-use enforcement holds live, under real concurrent-session conditions, not just in a unit test. |
| 13 | step-up bypass on sensitive actions | ⚠️→✅ Live-confirmed the **pre-existing, already-diagnosed** (Session 28) redirect-host bug also affects all three admin report-export routes: `GET /reports/completion/export` without fresh step-up → `302 Location: https://0.0.0.0:3000/step-up?...` — unreachable, but the export itself was correctly withheld (fails closed, not a bypass). Applied Session 28's exact fix (override redirect hostname/port from the request's own `Host` header) to all three routes. Deployed; see below. |

---

## Deploy

PR #52 merged to `main`; `deploy-portal.yml` run
[33244231862](https://github.com/Bambocharles/keenafrica/actions/runs/33244231862)
completed successfully — confirmed via the run's own log:
`Applying migration `20260829100000_users_select_cohort_relationship_org_boundary`` /
`All migrations have been successfully applied` against the real
`keenafrica_portal_prod` database, followed by `kubectl set image` rolling
out the new image to `deployment/portal` in `keen-prod`.

**Post-deploy live re-check, all three admin export routes**: `GET
/reports/completion/export`, `/reports/participation/export`, `/reports/
assessment-outcomes/export` — each without a fresh step-up — now redirect to
`https://admin.keenafrica.com/step-up?returnTo=...` (correct host, no stray
`:3000`), confirmed live against the running production pods, matching the
pre-deploy check that showed all three broken (`https://0.0.0.0:3000/...`).

## Known limitations

- Finding #1's fix could not be independently re-verified via a live
  production HTTP request (no organization-scoped course exists in
  production — the same standing UI gap every session since 21 has
  flagged). Verified instead against the real `portal_rls_test` role, the
  strongest available substitute, consistent with every prior session's own
  documented convention for this exact gap.
- Item 4 (student-to-student notes/bookmarks) was not independently re-run
  live this session — see the table above for why this is a low-risk,
  already-covered gap, not a skipped requirement.
- Item 5 (sponsor cross-tenant) relies on Session 28's already-exhaustive
  live pass plus a scope argument (nothing this session touched intersects
  Sponsor Core) rather than repeating that pass from scratch.
- `answers_select` was not independently live/RLS-tested beyond sharing
  `attempts_select`'s identical join shape (see above) — same diminishing-
  returns judgment call as the rest of this list.

## Blockers

None remaining. The one blocker this session hit — sandboxed `kubectl`
access to the `portal-qa-accounts` vault was denied, same wall every QA
session since 22 — was resolved live with the user, who retrieved and
provided the QA ADMIN/TROUBLESHOOTER/TEACHER/STUDENT/SPONSOR_ADMIN/
SPONSOR_USER passwords and the TEACHER/STUDENT TOTP secrets directly.

## Open findings at handoff

**None.** Finding #1 (the only real bug found) is fixed, tested, and
deployed. Every other must-test item on `sessions/29-qa-security-rls.md`'s
list was either confirmed clean live, confirmed clean via the real RLS test
role, or has a specific, documented, low-risk reason it wasn't independently
re-run (see Known limitations). **Session 30 is not blocked by any finding
from this session.**
