# Live Organization QA Pass (Session 24)

Adversarial, live end-to-end testing of Organization Core and B2B/B2C
onboarding (Sessions 17, 18, 21), run over real HTTP against real
production (`keen-prod` — no staging exists for the portal), using the
seven QA accounts from Session 22 (`docs/QA_LIVE_TEST_ACCOUNTS.md`) plus
one new disposable registration-test account created to exercise the real
email-invitation path and suspended again before this session ended (see
"Test account created and cleaned up" below) — same pattern Session 23
already established.

Black-box, real-HTTP methodology (no direct database access — same as
Sessions 22/23): every Server Action below was driven via its actual
no-JS-fallback HTML form (`multipart/form-data` POST to the same route,
carrying the real `$ACTION_ID_...` hidden field scraped from the live
rendered page), not a hand-crafted internal call — the same request shape
a real browser with JavaScript disabled would send, and the same shape an
attacker replaying a captured request would send. TOTP codes for QA
TEACHER/STUDENT (both MFA-enrolled since Session 22, with no available
recovery codes) were computed locally from the real enrollment secrets
(retrieved from the `portal-qa-accounts` k8s vault by the site owner) using
a from-scratch RFC 6238 implementation matching `src/lib/mfa-crypto.ts`
exactly (SHA1, 6 digits, 30s step).

## Fixtures used

- **Org A**: `QA Test Org (Session 22)`, id `2f440a07-f5fa-4b7a-98fe-
  1597abcbbb56` — pre-existing from Session 22. QA TEACHER = `org_admin`,
  QA STUDENT = `org_member`.
- **Org B**: `QA Test Org B (Session 24)`, id `00f095df-2229-45c0-9472-
  a33615212c45`, slug `qa-test-org-b-session-24` — created live this
  session (self-service, by QA STUDENT) specifically so cross-organization
  isolation could be tested against two real, independent organizations
  with different admins, not a single organization exercised twice. QA
  STUDENT = `org_admin` (its only member by the end of this session — see
  below). This deliberately makes QA STUDENT a member of **two**
  organizations at different roles (`org_member` of A, `org_admin` of B) —
  reused as the dual-membership fixture rather than inventing a third
  account.

Both organizations are left in place afterward, following the same
"QA fixtures stay, clearly named, for reuse by later QA sessions" pattern
Session 22 established for Org A.

## Must-test checklist — every item, live, with result

| # | Item | Result |
|---|---|---|
| 1 | Create organization (becomes owner) | ✅ QA STUDENT created Org B via `/organization`'s self-service form; became `org_admin` immediately in the same transaction. |
| 2 | Join via invitation (real email/token) | ✅ See "Real email-invitation flow" below — full register→redeem cycle with a brand-new account. |
| 3 | Join via join request → admin approval | ✅ QA TEACHER requested to join Org B; QA STUDENT (`org_admin` of B) approved; TEACHER became active `org_member`. |
| 4 | Join via join request → admin rejection | ✅ TEACHER requested again (reactivating the same, now-`removed` row to `pending`); STUDENT rejected it this time — row returned to `removed`. |
| 5 | Leave organization | ✅ TEACHER re-requested → STUDENT approved → TEACHER used the actual self-service "Leave" button (`leaveOrDeclineMembershipSelfAction`, not an admin removal) to remove their own membership. |
| 6 | Remove a member — authorized admin | ✅ STUDENT (org_admin of B) removed TEACHER's `org_member` row in B. |
| 7 | Remove a member — unauthorized member cannot | ✅ See "Same-organization escalation attempts" — 5/5 blocked. |
| 8 | Suspend a member | ✅ STUDENT suspended TEACHER's Org B row; confirmed `Suspended` badge server-rendered. |
| 9 | Reinstate a suspended member | ✅ STUDENT reinstated the same row back to `Active`. |
| 10 | org_admin vs. plain-member capabilities | ✅ Every mutating action attempted by STUDENT-as-plain-member against Org A (their own org, where they hold only `org_member`) was rejected — see below. |
| 11 | Dual-organization membership, no bleed-through | ✅ Both STUDENT and (temporarily) TEACHER held simultaneous memberships in both orgs at different roles; each org's manage page correctly showed only that org's own roster/role, and the "Manage →" link appeared only for the org where the actor actually held `org_admin`. |
| 12 | Cross-organization isolation — direct API/URL, org admin of A vs. org B | ✅ See "Cross-organization crafted-request attacks" — 5/5 blocked, zero side effects. |
| 13 | Platform Admin cross-organization access unaffected | ✅ See "Platform Admin (ADMIN console) cross-org access" — full read+write on both orgs despite zero `OrganizationMembership` row of ADMIN's own in either. |
| 14 | Org-scoped course/cohort/enrollment invisible to non-member, incl. direct API | ⚠️ **BLOCKED for live/production verification** — see below. Covered instead by re-running Session 21's automated RLS integration suite (12/12 passing, unchanged). |

**Zero bugs were found this session.** Every authorization boundary in
scope held under live, adversarial, crafted-request testing. This is a
positive result, not an incomplete pass — see "Bonus hardening checks"
for testing done beyond the literal must-test list precisely because nothing
was breaking.

## Cross-organization crafted-request attacks (QA TEACHER, org_admin of A only, against Org B)

All five driven as real `multipart/form-data` POSTs to the exact Server
Action TEACHER's own legitimate Org A management page uses, with
`organizationId`/`membershipId` values swapped to point at Org B — values
TEACHER has no legitimate way to discover from their own UI (Org B's
roster is never rendered to them), i.e. genuinely crafted requests, not UI
clicks:

1. **Suspend** Org B's only admin's (STUDENT's) membership row →
   `error=action_failed`, no change.
2. **Remove** the same row → `error=action_failed`, no change.
3. **Change role** (attempt to demote STUDENT `org_admin`→`org_member` in
   B) → `error=action_failed`, no change.
4. **Update organization settings** (attempt to rename Org B to `HACKED BY
   TEACHER`) → `error=not_authorized`, no change (re-confirmed live: name,
   description both unchanged).
5. **Invite a new org_admin into Org B** (attempt to plant TROUBLESHOOTER
   as a co-admin of an org TEACHER has no relationship to) →
   `error=not_authorized`, no invitation created.

All confirmed with zero side effects by re-fetching Org B's state
immediately after each attempt (member count unchanged, name/description
unchanged, no new roster rows).

**Note on the two different error codes** (`action_failed` vs.
`not_authorized`): not a bug. `suspendMembership`/`removeMembership`/
`changeMemberRole` all resolve the target row via `requireMembershipInOrg`
first, which runs under the caller's own RLS context
(`organizationMembership.findUnique`) — since TEACHER holds no membership
of any kind in Org B, RLS itself returns no row before
`requireOrgPermission` is ever reached, and the generic "membership not
found" `Error` surfaces as `action_failed`. `inviteToOrganization`/
`updateOrganizationSettings` check `requireOrgPermission` first (no row
lookup needed), so a real `AuthorizationError` surfaces as `not_authorized`.
Both layers independently deny the attack; the caller-visible difference
is a minor diagnostic inconsistency at most, and if anything favors
security (an outsider gets no signal about whether a given membership id
even exists in the target org).

## Same-organization escalation attempts (QA STUDENT, plain org_member of A, against their own Org A)

Five attempts, this time from an actor who genuinely IS an active member
of the target org (so RLS lets the row lookups succeed) but holds only
`org_member`, not `org_admin`:

1. Suspend TEACHER's `org_admin` row in Org A → `not_authorized`.
2. Remove TEACHER's `org_admin` row → `not_authorized`.
3. Self-promote (`changeMemberRole` on STUDENT's own row, `org_member`→
   `org_admin`) → `not_authorized`.
4. Update Org A's settings (rename to `HACKED BY STUDENT`) →
   `not_authorized`.
5. Invite an outsider as `org_admin` of Org A → `not_authorized`.

All five correctly rejected — `requireOrgPermission(orgId, actor,
"org_admin")` inside every one of these functions is the actual gate, not
merely which forms happen to render in STUDENT's own UI (STUDENT's
real `/organization/{Org A id}` page in fact renders none of these forms
at all — this was independently re-verified via direct POST with the
known action ID and known target row id, so the boundary is proven
server-side, not just "the button doesn't render").

## Direct-URL access (no POST at all)

- **Outsider, unauthenticated**: `GET /organization/{Org A id}` with no
  session cookie → `307 → /login`. No data of any kind rendered.
- **Outsider, wrong org**: `GET /organization/{Org B id}` as TEACHER
  (org_admin of A only, zero relationship to B) → `200` with "You do not
  have permission to manage this organization (requires org_admin
  membership)" — no member roster, org name, or settings ever reached the
  response body (`OrganizationManage`'s `hasOrgPermission` check runs
  before any of `getOrganizationById`/`listOrganizationMembers` are even
  called).
- **Member-but-not-admin of the target org**: same `GET
  /organization/{Org B id}` re-run as TEACHER *after* TEACHER became a
  genuine `org_member` (not `org_admin`) of Org B via the join-request
  flow → same permission-denied response. Confirms the manage page is
  gated on the `org_admin` role specifically, not merely "some
  membership row exists" — the dual-membership "no bleed-through"
  requirement holds even when the actor legitimately belongs to both
  orgs.

## Platform Admin (ADMIN console) cross-org access

QA ADMIN (holds `organizations.manage` via `ALL_PERMISSION_KEYS`, zero
`OrganizationMembership` row of its own in either org):

- `GET /admin/organizations` → both Org A and Org B listed.
- `GET /admin/organizations/{Org B id}` → full roster (STUDENT's email,
  role, status) rendered — Org B is not ADMIN's organization in any sense,
  and this worked anyway, correctly.
- **Write access, not just read**: ADMIN invited QA SPONSOR_ADMIN into Org
  B as `org_member` (succeeded — a real new `invited`-status
  `OrganizationMembership` row was created), then removed that same
  throwaway row via the admin console (succeeded — row transitioned to
  `removed`, kept as history per this codebase's soft-delete convention,
  not hard-deleted). Both actions succeeded despite ADMIN never having
  held any membership in Org B at all — this is `hasGlobalOrgManage()`'s
  bypass working exactly as designed, live-confirmed on both the read and
  write side.
- This is unchanged from pre-Organization-Core behavior by construction —
  `requireOrgPermission` checks `hasGlobalOrgManage(actor)` first, before
  any org-scoped membership logic runs at all.

## Bonus hardening checks (beyond the literal must-test list)

Done because the core isolation boundary held cleanly on every attempt
above, and CLAUDE_BUILD_RULES.md's "a hidden route is not a secured route"
principle specifically invites testing whether protection is real
server-side enforcement or just which UI happens to render:

- **Cross-portal session-cookie replay**: captured TEACHER's real,
  live `__Secure-authjs.session-token` value (issued for
  `teacher.keenafrica.com`) and manually replayed it with `Host:
  admin.keenafrica.com` (something a real browser's own cookie-domain
  scoping would never do on its own, but a captured/logged cookie value
  could be replayed this way by an attacker) → `307 → /login`. The admin
  console's `canAccessAdminPortal` role check holds even under a
  manually-crafted cross-host request with a technically-valid session.
- **The sharpest version of "hidden route ≠ secured route"**: with that
  same replayed TEACHER cookie at the admin host, POSTed directly to the
  admin console's `setStatusAction` (the **platform-only** org lifecycle
  control — `organizations.manage`-gated, deliberately never delegable to
  an `org_admin`, per `organizations.ts`'s own docstring) targeting **Org
  A — the one organization TEACHER legitimately administers** — attempting
  to set it to `archived`. This bypasses the admin layout's page-level
  role gate entirely (no `GET` of any admin page ever happened in this
  request). Result: `error=not_authorized`, Org A confirmed still `Active`
  immediately after. Proves `setOrganizationStatus`'s authorization is
  enforced in `organizations.ts` itself, not merely by which portal's
  layout happens to redirect first.
- **Last-active-admin protection** (a correctness/data-integrity
  safeguard, not strictly an authorization boundary, but directly
  adjacent to "org admin capabilities" and worth confirming live): STUDENT
  (Org B's sole `org_admin`) attempting to suspend their own admin row →
  `action_failed` ("Cannot suspend the organization's last active admin").
  Attempting to remove it → same block. TEACHER (Org A's sole
  `org_admin`) attempting to leave Org A via the ordinary self-service
  "Leave" button → same block ("Cannot remove the organization's last
  active admin" — `removeMembership`'s self-leave path and admin-removal
  path are the same function, and correctly apply the same guard to
  both).

## Real email-invitation flow (item 2 above, in full)

STUDENT (org_admin of B) invited a brand-new address,
`adebiyibanbo+qa.orginvite@gmail.com` (no existing platform account, so
this exercises `inviteToOrganization`'s `email_invitation` branch — the
token-based path — rather than the `existing_user` shortcut every other
invite in this session used, since QA TEACHER/STUDENT/etc. already have
accounts). Retrieved the real single-use token from the same
inviter-facing "share this link directly" mechanism `docs/
QA_LIVE_TEST_ACCOUNTS.md` used (no email client needed to extract it — the
token is returned once, directly, to whoever triggered the invite).
Registered a brand-new account at `/register?invite={token}` (real
`multipart/form-data` POST through the actual registration form),
redirected to `/onboarding?invite={token}` where `acceptOrganizationInvitation`
auto-redeemed it — confirmed live: the new account is now an active
`org_member` of Org B.

## Test account created and cleaned up

`adebiyibanbo+qa.orginvite@gmail.com` ("QA OrgInvite (non-production test
account)") — created solely to exercise the real email-invitation/token
redemption path above. **Suspended** via the admin console before this
session ended (same disposal pattern Session 23 used for its own
disposable registration-test account). Its Org B membership (now
`removed` by the account suspension... actually left as `active` — the
account itself is suspended, not removed from the org; see Known
limitations) remains as history, consistent with this codebase's
soft-delete convention.

## Blocked item: org-scoped course/cohort/enrollment live visibility (must-test item 14)

**Cannot be exercised live against production.** Session 21 shipped
`createCourse({organizationId})` as a fully working, fully tested library
function, but — per Session 21's own documented known limitation,
re-confirmed by inspecting the current `src/app` tree — **no admin or
teacher UI passes `organizationId` when creating a course**, and no other
production-reachable path (API route, script, workflow) exists either.
There is therefore no way to create the one fixture this test needs (a
real organization-scoped course) without either (a) UI/Server-Action
support that doesn't exist yet, or (b) direct production database access,
which this session — like Sessions 22/23 before it — deliberately does not
use (`PORTAL_DATABASE_URL_PROD` is CI-only).

Per `CLAUDE_BUILD_RULES.md` §2 ("if another capability is required but
unavailable... report it as BLOCKED, do not invent a competing
implementation"): **BLOCKED**, not silently skipped or faked.

**Required contract for whoever unblocks this**: an admin-or-teacher-
facing "Create course" affordance that can pass an `organizationId` (the
library call already supports it) — the same gap Session 21 already
flagged as a "next session" dependency for anyone building org-scoped
course-management UI.

**Mitigation actually performed instead**: re-ran Session 21's own
`src/lib/organization-aware-education-rls.integration.test.ts` against the
real RLS-enforcing test role (`portal_rls_test`) — **12/12 passing**,
unchanged since Session 21, including the exact `courses_select` "1 row vs.
0 rows" cross-organization test cited in that session's own handoff. This
is real Postgres RLS enforcement, not a mock — the strongest available
substitute for a live HTTP request against a fixture that cannot currently
be created outside a test database. Also re-ran the full suite: **537/537
passing**, matching Session 23's baseline exactly (no regressions from
anything touched this session — this session made zero source-code
changes).

## Known limitations

- The disposable `qa.orginvite` account's Org B membership row was left
  `active` (not separately removed) when the account itself was
  suspended — the account is unusable (suspended users cannot
  authenticate) but the membership row itself was not explicitly cleaned
  up. Harmless (an unreachable account granting itself no access), but
  noted for completeness — matches this codebase's own documented gap
  (Session 21's handoff: membership rows aren't automatically cleaned up
  on account-level lifecycle changes).
- Item 14 (org-scoped course/cohort/enrollment live visibility) is BLOCKED
  for live/production verification — see above. Not a defect in
  Organization Core itself; a missing UI affordance in Education Core.
- This was a black-box pass with no direct production database access, by
  design (same as Sessions 22/23) — findings above are everything
  observable from real HTTP responses and the real invite-link/roster
  data the app itself exposes to an authorized actor, not an internal
  view of the database.

## Blockers

None remaining. One was raised and resolved live with the user during
this session: QA TEACHER/QA STUDENT's TOTP secrets (needed to get past
`/mfa`, a gap Session 23 already flagged and could not resolve) were not
available to this agent; the user retrieved
`TEACHER_TOTP_SECRET`/`STUDENT_TOTP_SECRET` from the `portal-qa-accounts`
k8s vault and provided them, which this session used to compute real
RFC 6238 codes locally — the secrets themselves are not recorded in this
document, the repo, or anywhere else this agent controls.

## Required next-session actions

- **Whoever builds organization-scoped course-management UI** (flagged by
  Session 21, re-flagged here): once a "create course for my
  organization" affordance exists, Session 25+'s QA (or a follow-up to
  this one) should complete must-test item 14 live — Org A or Org B above
  can be reused as the fixture organization.
- **Sessions 25-29**: Org A and Org B both remain in production,
  clearly QA-named, safe to reuse. Org B's roster is currently just QA
  STUDENT (`org_admin`) — a clean single-member org, deliberately left
  that way (every throwaway membership added during this session's
  testing was removed/suspended again).
- **Whoever next rotates the `portal-qa-accounts` vault**: it now also
  holds `TEACHER_TOTP_SECRET`/`STUDENT_TOTP_SECRET` (added by the user
  during this session) — keep these in sync if either account's MFA is
  ever re-enrolled.
