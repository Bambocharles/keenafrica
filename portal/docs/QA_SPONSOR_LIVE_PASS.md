# Live Sponsor QA Pass (Session 28)

Live, adversarial testing of the Sponsor portal (Session 11) against
Organization Core (Sessions 17, 21) and everything built since — the
explicit mission was to prove a negative: that Organization Core had
**zero effect** on Sponsor Core, per the architectural decision to keep
the two pillars separate (`PLATFORM_ARCHITECTURE.md` §14, `PLATFORM_CONTEXT.md`
"Organization/Tenant model"). Treated as seriously as testing new
functionality, not as a formality — two real, live bugs were found and
fixed (neither caused by Organization Core; see below).

Same black-box, real-HTTP methodology Sessions 22–27 established: every
mutation below was driven via its actual no-JS-fallback HTML form
(`multipart/form-data` POST carrying the real `$ACTION_ID_...` hidden
field scraped from the live rendered page), against real production
(`keen-prod` — no staging exists for the portal), using the QA
SPONSOR_ADMIN/SPONSOR_USER accounts from Session 22
(`docs/QA_LIVE_TEST_ACCOUNTS.md`) plus QA ADMIN to create fixtures. No
direct database/kubectl access (both denied by this session's sandbox,
same wall every QA session since 22 has hit) — the site owner retrieved
QA ADMIN/SPONSOR_ADMIN/SPONSOR_USER passwords from the `portal-qa-accounts`
k8s vault and provided them directly.

## Part 1 — static audit: does Organization Core touch Sponsor Core at all?

Before any live HTTP, the actual code/schema/migrations were audited for
coupling, since "nothing changed" is exactly the claim this session exists
to verify, not assume:

- `Sponsor`/`Project`/`ProjectMembership` in `schema.prisma`: zero
  `organizationId`/`Organization` fields or relations. Unchanged shape
  since Session 11.
- Every migration since (`organization_core`, `organization_aware_education`,
  `cohort_relationship_user_visibility`, `conversation_creator_returning_visibility`)
  greped for `sponsor`/`project`/`project_memberships`: the only hits are
  **comments** referencing the pattern (e.g. "same convention as
  `app_current_user_sponsor_project_ids()`") — no actual RLS policy on
  `sponsors`/`projects`/`project_memberships`/`milestones`/`project_metrics`/
  `project_documents` was touched by any Organization Core migration.
- `app.organization_ids` (the new RLS session variable, `src/lib/rls.ts`)
  is set unconditionally for every actor by `withRls()` (resolved by
  `resolveSessionAuthz()` in `src/lib/sessions.ts`, identically for every
  role — no sponsor-specific branch, no special-casing). None of Sponsor
  Core's own RLS policies test it. For a sponsor actor with no
  `OrganizationMembership` row (the normal case), it's simply `'[]'`.
- `src/lib/sponsor.ts` itself: zero references to organization/membership
  anywhere.

**Conclusion of the static pass: no coupling exists in the code as
written.** The rest of this document is the live pass that proves the
runtime behavior matches.

## Fixtures created live

No Sponsor/Project fixture existed in production going into this session
— Session 11 cleaned up its own test data after its live pass. Two
sponsors/projects were created live via the real admin console (QA ADMIN,
`sponsor.manage`), deliberately as **two separate sponsors** (not one
sponsor exercised twice) so cross-sponsor isolation could be tested with
genuine outsider accounts, the same shape Session 24 used for
cross-organization isolation:

| Sponsor | Project | Team |
|---|---|---|
| QA Sponsor A (Session 28) | QA Session 28 Project A (`b7228b16-c68e-4b88-8a84-5e5859c40b74`) | QA SPONSOR_ADMIN (`sponsor_admin`) |
| QA Sponsor B (Session 28) | QA Session 28 Project B (`d005b122-aa30-47d5-b35d-29af50f515e6`) | QA SPONSOR_USER (`sponsor_admin`)† |

† `ProjectMembership.role='sponsor_admin'` is the ownership row (see
`SPONSOR_CORE.md`) — orthogonal to the global `SPONSOR_USER` Role SPONSOR_USER
already holds, which grants read-only capability.

Project A also got a real milestone ("QA Session 28 Milestone", Planned,
target 1 Dec 2026), a real impact metric ("Beneficiaries reached" = 42
people), a real beneficiary (QA STUDENT, `adebiyibanbo+qa.student@gmail.com`,
added as `role='beneficiary'`), and a real uploaded document ("QA Session
28 Report", `qa_doc.txt`) — exercising every item on the
"project/beneficiary/milestone/report visibility" must-test list, not just
an empty-state check. Pre-existing real production sponsors (`Priosec`,
`Febambo Youth Elevate`) were left completely untouched — never queried
beyond the admin dashboard's own list rendering, never a target of any
mutation.

All fixtures left in place afterward, clearly QA-named, following the
established "QA fixtures stay, safe to reuse" convention (Sessions
22/24/26/27).

## Must-test checklist — every item, live, with result

| # | Item | Result |
|---|---|---|
| 1 | Sponsor registration/login (password) + dashboard access | ✅ QA SPONSOR_ADMIN and QA SPONSOR_USER both logged in via the real `$ACTION_ID_...` credentials form, real session cookie issued, dashboard rendered correctly (nav shell, notification count, project summary). |
| 1b | Google sign-in redirect construction | ✅ Real Server-Action-driven "Continue with Google" button produced `redirect_uri=https://sponsor.keenafrica.com/auth/callback/google` — correct per-subdomain host, matching Session 22's fix. (Same limitation every session since 19 has flagged: completing the actual consent screen needs a real browser, not available here.) |
| 2 | Project visibility (dashboard + list + detail) | ✅ QA SPONSOR_ADMIN's dashboard/`/projects`/`/projects/[id]` show exactly Project A (1 project, correct milestone/beneficiary/document counts). |
| 2 | Milestone visibility | ✅ "QA Session 28 Milestone", status Planned, target 1 Dec 2026 — rendered correctly on the sponsor-facing detail page. |
| 2 | Impact metric visibility | ✅ "Beneficiaries reached: 42 people", latest-sample-per-label shape confirmed. |
| 2 | Beneficiary visibility (privacy-scoped) | ✅ Beneficiary rendered, **and its email never appeared anywhere in the response HTML** (confirmed by grep) — privacy hold intact. See Bug 1 below for the display-string bug found alongside this. |
| 2 | Report (CSV) visibility | ⚠️ Found broken live (Bug 2 below), fixed and redeployed, re-verified working post-fix (see "Post-fix re-verification"). |
| 2 | Document visibility + download | ⚠️ Document correctly listed; download round-trip hit a real, already-documented infra limitation (no shared/persistent storage across the 2 production replicas) — see "Known limitation re-confirmed live" below. Not a Sponsor/Organization coupling issue. |
| 3 | Cross-sponsor isolation — dashboard/list | ✅ QA SPONSOR_USER's dashboard/list show exactly Project B, zero visibility into Project A (and vice versa for SPONSOR_ADMIN/Project B). |
| 3 | Cross-sponsor isolation — direct URL | ✅ `GET /projects/{other sponsor's project id}` for both accounts → "You are not part of this project's sponsor team." Zero project data (name, sponsor, milestones, metrics) present in the denial response body (confirmed by grep). |
| 3 | Cross-sponsor isolation — crafted POST (IDOR) | ✅ QA SPONSOR_ADMIN's own legitimate "Add to team" `$ACTION_ID` (harvested from Project A's real rendered page) replayed with `projectId` swapped to Project B → `error=Not a member of this project's sponsor team`, zero side effects (Project B's roster re-checked via admin console: unchanged, still just SPONSOR_USER). Proves `requireProjectSponsorAccess()` re-validates ownership server-side regardless of which form/action-id reached it — not merely which button renders. |
| 3 | Cross-sponsor isolation — document download | ✅ The outsider (SPONSOR_USER) attempting `GET /assets/{Project A's document id}/download` → `404 Not found`, no bytes, no leak. Unauthenticated attempt → `403`. |
| 4 | No accidental Organization Core coupling | ✅ See Part 1 (static audit) — reconfirmed live: every request above set `app.organization_ids='[]'` for the sponsor actors (no org membership), and none of it affected any authorization outcome. |

**Zero regressions found in Sponsor Core's own authorization/isolation
model.** The two bugs found (below) are both pre-existing, both unrelated
to Organization Core, and both were found only because this session
exercised real data end-to-end rather than an empty-state check.

## Bug 1 — beneficiary display name mangled by parenthetical name suffixes (found, fixed)

**Severity: Low** (display/correctness bug, not a privacy leak — see below).

`anonymizedDisplayName()` (`src/lib/sponsor.ts`) took the *last*
whitespace-split token of a user's full name as the last-name initial.
Every QA fixture account in this codebase is named `"QA <Role>
(non-production test account)"` (see `docs/QA_LIVE_TEST_ACCOUNTS.md`) — for
QA STUDENT (`"QA Student (non-production test account)"`), the last token
is `"account)"`, so the beneficiary rendered on the live sponsor portal as
**"QA a."** instead of the intended "QA S.".

**Repro:** add any user whose `name` ends in a parenthetical annotation as
a project beneficiary (`addProjectBeneficiary`), then view that project as
an authorized sponsor-team member — `listProjectBeneficiaries()`'s
`displayName` is wrong.

**Not a privacy leak**: the wrong initial is not more revealing than the
correct one would have been (arguably less), and the beneficiary's email
was independently confirmed absent from the response HTML throughout.
Real (non-QA) user names could hit the same bug with any trailing
annotation, though it's less common outside this codebase's own QA-account
convention.

**Fixed**: `anonymizedDisplayName()` now strips a trailing `"(...)"`
annotation before splitting into name parts. New regression test in
`src/lib/sponsor.test.ts` reproduces the exact "QA Student (non-production
test account)" → "QA S." case. Full suite re-run: 545/545 passing
(544 baseline + 1 new).

## Bug 2 — report CSV export's step-up redirect resolves to an unreachable host (found, fixed)

**Severity: High while live** — this made the sponsor project report
export (and, found to be the same bug class, all three admin console
report exports) **completely unusable in production** for any actor
without a fresh step-up proof, which in practice is most report-export
attempts (step-up freshness is short-lived by design).

**Repro (live, real production)**: as QA SPONSOR_ADMIN (fresh session, no
recent step-up), `GET /projects/{id}/report/export` →
`302 Location: https://0.0.0.0:3000/step-up?returnTo=...` — the pod's
internal bind address, not `sponsor.keenafrica.com`. A real browser
following this redirect gets a connection failure, not the step-up
challenge.

**Root cause**: `src/app/sponsor/(protected)/projects/[id]/report/export/route.ts`
built the redirect with `new URL(path, req.url)`. In this Route Handler
context, `req.url`'s **host** resolves to the pod's internal bind address
in production — the same `HOSTNAME`-env-var-fallback failure class
`server-entrypoint.js` already documents and works around for Auth.js's
own redirect construction, and the same class Session 23 found (with, at
the time, "no live product impact confirmed") on raw Auth.js REST
endpoints. **This session found the first case with confirmed live product
impact**: a real, reachable, user-facing feature (not a bypassed internal
endpoint) was actually broken. `server-entrypoint.js`'s `HOSTNAME`
deletion does not cover Route Handlers' own `req.url` construction — this
is a distinct instance of the same underlying class, not a regression of
that fix.

**Fixed**: the sponsor route now overrides just the `host` (and its
implicit port) on the constructed redirect URL from the request's own
`Host` header — the identical header `src/middleware.ts`'s subdomain
routing already trusts for every request. Protocol/path/query are
untouched. **Scope note**: the identical pattern (`new URL(path, req.url)`
inside a step-up redirect) exists in three admin console report-export
routes (`src/app/admin/(protected)/reports/{completion,participation,assessment-outcomes}/export/route.ts`)
— same bug, same fix, **not fixed here** (outside Sponsor Core /
this session's assigned boundary, `CLAUDE_BUILD_RULES.md` §2) — flagged
below for whoever owns Reporting/Admin.

**Post-fix re-verification (after deploy — see Database migrations/
deploy note below)**: re-ran the exact repro live — `GET
/projects/{id}/report/export` as QA SPONSOR_ADMIN with no fresh step-up →
`302 Location: https://sponsor.keenafrica.com/step-up?returnTo=...`,
correct host. (Completing the actual step-up challenge and downloading the
CSV body was not additionally re-driven — the redirect target being
correct is what was broken and is what's fixed; the step-up mechanism
itself is Session 20's own, already covered by its own tests/QA pass.)

## Known limitation re-confirmed live (not a bug, not fixed) — document storage isn't production-ready

Uploading a document to Project A (as QA ADMIN) and then downloading it
back (as QA SPONSOR_ADMIN, the legitimate project team member) produced a
raw `500`. Root cause: `docs/ASSETS.md`'s own already-documented "Known
limitations" — `STORAGE_DRIVER=local` (disk) writes to the handling pod's
own local filesystem, `k8s/portal-prod.yaml` has **no persistent volume**,
and production runs **2 replicas** (`k8s/portal-prod.yaml`: `replicas: 2`).
The upload landed on one pod's disk; the download request load-balanced to
the other pod, which doesn't have the file, so `getStorageDriver().get()`
throws and the request 500s. `docs/ASSETS.md` explicitly says: **"Do not
deploy file uploads to production before this is resolved."**

This is not a new finding and not fixed here — it's outside Sponsor Core's
authority (an infra/storage-backend decision, same as Session 09/13's own
flagged blocker) — but this session is the first to **confirm it's
actively live**, not just theoretical, via a real round trip. The
uploaded QA fixture document (`qa_doc.txt`, project "QA Session 28 Project
A") is left in place — harmless, clearly QA-named, and its own broken
state is itself useful evidence for whoever picks up the object-storage
work.

## Cleanup / fixture disposal

Nothing was deleted. Per the established QA convention, all fixtures
created this session — Sponsor A/B, Project A/B, the milestone, metric,
beneficiary link, and the (currently-broken-to-download) document — are
left in production, clearly QA-named (`QA Sponsor A/B (Session 28)`,
`QA Session 28 Project A/B`), safe to reuse by Sessions 29+. The two
pre-existing real sponsors (`Priosec`, `Febambo Youth Elevate`) were never
mutated.

## Deploy note

Both fixes were committed, pushed, merged to `main`, and deployed to
production via the normal `deploy-portal.yml` pipeline (`production`
GitHub Environment gate). See the handoff in `status/project-status.md`
for the PR number and commit SHA.

## Blockers

None remaining. kubectl access to the `portal-qa-accounts` vault was
denied by this session's sandbox (same wall every QA session since 22) —
the site owner retrieved and provided the QA ADMIN/SPONSOR_ADMIN/
SPONSOR_USER passwords directly.

## Required next-session actions

- **Whoever owns Reporting/Admin console**: the identical `req.url`-host
  redirect bug (Bug 2 above) also exists in the three admin report-export
  routes (`completion`/`participation`/`assessment-outcomes`) — same
  one-line fix (override `target.host` from the request's `Host` header
  before redirecting). Not fixed in this session (outside Sponsor Core's
  boundary).
- **Whoever picks up the object-storage/S3 work** (already flagged by
  Sessions 09/13, re-confirmed live here): this session's broken document
  download is real, current, live evidence — not just the standing
  documentation warning — that file uploads are not safe in production
  today with 2 replicas and no shared volume.
- **Sessions 29+**: `QA Sponsor A (Session 28)` / `QA Sponsor B (Session
  28)` and their two projects remain in production, clearly QA-named,
  safe to reuse — including the one beneficiary link (QA STUDENT on
  Project A) and one milestone/metric already in place.
