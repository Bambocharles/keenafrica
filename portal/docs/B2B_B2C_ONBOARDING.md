# B2B & B2C Onboarding (Session 18)

The platform's first self-service account-creation flow. Before this
session there was no signup/register route anywhere in this repo —
`admin`/`teacher`/`student`/`sponsor` each had only `/login` (and some
`/reset-password`); every account was admin/seed-provisioned via
`src/lib/users.ts`'s `createUser()`. This session builds registration from
zero and wires it to Session 17's Organization Core
(`Organization`/`OrganizationMembership`/`OrganizationInvitation`,
`src/lib/organizations.ts`) — reused entirely as-is, no parallel membership
concept invented.

## Registration

- `teacher.<root>/register` and `student.<root>/register` — the subdomain
  IS the platform-role choice, the same convention `/login` already uses.
  `admin`/`sponsor` remain admin-provisioned only; there is no public
  registration for those roles (sessions/18's mission is explicitly "a new
  teacher or student").
- `src/lib/registration.ts`'s `registerUser({ email, password, name, role })`
  is the only other path (besides `users.ts`'s `createUser()`) that may ever
  INSERT a `users` row. `role` is restricted to `TEACHER`/`STUDENT`
  (`REGISTERABLE_ROLES`) — no public path to an `ADMIN`/`SPONSOR_*` account.
  Password minimum 8 characters; email/name required; duplicate email
  (case-insensitive, the existing `citext` column) returns `email_taken`
  rather than throwing.
- New RLS session var `app.self_registration`
  (`20260828100000_self_registration` migration) authorizes exactly the
  one pre-auth INSERT into `users` and its accompanying `user_roles` row —
  same "pre-auth carve-out" convention as `app.auth_lookup` /
  `app.password_reset_lookup` / `app.rate_limit_lookup`. Nothing else ever
  sets this flag.
- The register page's Server Action signs the new account in immediately
  afterward through the *exact same* Auth.js Credentials flow `/login`
  uses (`src/lib/auth.ts`) — no second session/identity system. This also
  means the account is real and login-tested the moment registration
  completes, not a separate "pending verification" state.

## Post-registration decision — /onboarding and /organization

`src/components/organization/OrganizationHome.tsx` is one shared component
rendered by both:
- `{teacher,student}/(protected)/onboarding/page.tsx` — shown right after
  registration (`signIn(...redirectTo: "/onboarding")`). Presents: create
  an organization, search/request to join one, or "skip for now" (a plain
  link to `/dashboard` — the B2C "no organization" path, immediately
  usable, per the session's acceptance criterion).
- `{teacher,student}/(protected)/organization/page.tsx` — the durable,
  revisit-anytime version: every existing membership (accept/decline an
  `invited` row, leave an `active` one, see `pending` state), the same
  create/join UI, and a "Manage →" link into any organization the caller
  is `org_admin` of.

One component for both surfaces (a `mode: "onboarding" | "workspace"`
prop) rather than duplicating the create/join/accept/decline logic and its
authorization boundaries per portal per surface, per
`CLAUDE_BUILD_RULES.md` §3.

**Create an organization**: `createOrganization()` (Session 17, unchanged)
— any authenticated actor, no permission gate. The founder becomes that
org's `org_admin`, active immediately.

**Join an organization**: `src/lib/organizations.ts`'s new
`searchJoinableOrganizations(search, actor)` — any authenticated actor (not
`organizations.manage`), relies entirely on `organizations_select`'s own
"any authenticated caller may see any non-archived organization's basic
profile" RLS branch, which Session 17's migration comment explicitly
anticipated for this exact use case. Returns only
`id`/`name`/`slug`/`type`/`status` — no `contactEmail`/`contactPhone` (kept
out, unlike `getOrganizationById`). "Request to join" calls
`requestToJoinOrganization()`, which only ever creates a `pending` row —
**never active** — matching the session's explicit Rule ("never let
someone become a member just by typing its name").

**Invitation redemption**: `?invite=<token>` on `/register` carries an
`OrganizationInvitation` token through registration into
`/onboarding?invite=<token>`, where `OrganizationHome` calls
`acceptOrganizationInvitation(token, actor)` (Session 17, unchanged) the
moment a real actor exists — the person lands **already linked at the
offered role**, no decision UI shown. An invalid/expired token shows a
banner and falls through to the normal create/join/skip flow instead of
blocking. **Live-verified end-to-end** against a real running server
(see "Verification" below): register → auto sign-in → auto-redeem → active
membership, and a second redemption attempt with the same (now-consumed)
token correctly reports invalid/expired.

An **existing account** invited directly (no token — `inviteToOrganization`
creates an `invited`-status row for a known email) sees it in
`/organization`'s "Pending invitations" section with Accept/Decline —
`acceptOrganizationMembershipInvite()` / `removeMembership()` (self),
both Session 17 functions, unchanged.

## Organization owner/admin UI

`src/components/organization/OrganizationManage.tsx`, rendered at
`{teacher,student}/(protected)/organization/[id]/page.tsx` — reachable by
whoever holds an ACTIVE `org_admin` `OrganizationMembership` for that
specific organization (`hasOrgPermission(id, actor, "org_admin")`), from
**either** portal (a person's org-scoped role is independent of their
platform TEACHER/STUDENT role). Deliberately **not** the same surface as
the admin console's `/admin/organizations/[id]`
(`organizations.manage`-gated, Session 17, untouched by this session) —
this one omits the platform status-lifecycle controls
(pending/active/suspended/archived), since `setOrganizationStatus()` is
`organizations.manage`-only by design, never delegable to an `org_admin`.

Provides: settings edit, invite-by-email (with an offered org role AND a
UI-only "register as teacher/student" selector — see "Email delivery"
below), approve/reject a pending join request, suspend/reinstate/remove a
member, change a member's org role, revoke a pending email invitation.
Every mutation reuses Session 17's `organizations.ts` functions verbatim —
this session added zero new mutation logic to that module beyond the
read-only `searchJoinableOrganizations`.

## Email delivery — stubbed, contract fully defined (BLOCKED on Session 19)

No transactional email provider exists in this infra yet (Session 19's
job — the same gap already documented for password reset in
`docs/IDENTITY_SECURITY.md`). `inviteMemberSelfAction`
(`src/lib/onboarding-actions.ts`) calls `src/lib/mailer.ts`'s `sendMail()`
exactly as-is: dev-console-logs outside production, **throws in
production** (`sendMail()`'s own documented contract). The action wraps
that call in a `try/catch` and swallows the failure — same established
pattern as `src/app/admin/(protected)/users/[id]/actions.ts`'s
`triggerPasswordResetAction` and `src/app/student/(protected)/profile/
actions.ts`'s `requestOwnPasswordResetAction`.

Either way, the invite link is **also** stashed in a short-lived (60s),
`httpOnly`+`Secure`-in-production cookie
(`org_invite_link_<invitationId or membershipId>`) so the org_admin who
triggered the invite can see and relay it manually — shown once on
`OrganizationManage` via `?inviteLinkKey=...`. This is the exact same
"contract fully defined, live delivery stubbed" shape Session 02 already
established for password reset; **BLOCKED specifically on live email
delivery**, not on the invite flow itself, per this session's own
instructions.

`platformRole` (`TEACHER`/`STUDENT`) on the invite form is **UI-only** —
never persisted (`OrganizationInvitation` has no platform-role column). It
only picks which subdomain's `/register` (new account) or `/login`
(existing account) the constructed link points at, since the org admin
knows which role they're inviting someone as but `OrganizationInvitation`
only ever tracks the *org*-scoped role offered.

**What Session 19 needs to do**: implement `sendMail()` against a real
provider behind its existing signature. Every caller here (and password
reset) already goes through it — zero call-site changes needed once a
provider is wired up.

## Account status during onboarding

An `invited`/`pending` `OrganizationMembership` row grants **no**
organization-scoped access — `resolveSessionAuthz()`
(`src/lib/sessions.ts`, Session 17, unchanged) only ever populates
`app.organization_ids` from `status: "active"` rows, re-checked on every
request. Live-verified: a user with a `pending` join request hitting
`/organization/[id]` directly gets the same "you do not have permission to
manage this organization" response an outright stranger would, with no
roster/invite-form leakage. Nothing new was needed here — this was
already Session 17's guarantee; this session's job was confirming it holds
under a live registration → pending-join scenario, which it does.

## Verification

- `npm test`: 437/437 passing (423 baseline + 14 new — 9 in
  `registration.test.ts`, 3 in `organizations.test.ts`'s new
  `searchJoinableOrganizations` block, 3 new RLS integration cases), run
  both with and without `RLS_TEST_DATABASE_URL`. `tsc --noEmit` clean,
  `npm run build` clean (every new route appears in the manifest).
- **Live end-to-end, against a real production build (`npm run start`),
  not just unit tests**: registered a teacher (real HTTP, real Auth.js
  sign-in) → landed on `/onboarding` → created an organization (became
  `org_admin` immediately, confirmed via direct DB read) → invited an
  unknown email → registered that email on the student portal carrying
  `?invite=`, redeemed automatically, landed active `org_member` (confirmed
  via DB) → a second redemption attempt with the same token correctly
  rejected as invalid/expired → a third, independent registration searched
  for and requested to join the same organization (landed `pending`,
  confirmed no management access to `/organization/[id]`) → the `org_admin`
  approved it via the real UI action → confirmed `active` in the DB. All
  test data cleaned up from the dev database afterward.

## Known limitations

- No account-level "onboarding completed" flag — `/onboarding` and
  `/organization` render the same content; a user can revisit `/onboarding`
  any time (harmless — it's read-driven, not a one-time gate).
- `searchJoinableOrganizations` is a simple case-insensitive name
  substring match, capped at 20 results — no ranking/pagination. Fine at
  today's scale; revisit if the organization directory grows large.
- The "register as teacher/student" selector on the invite form is a
  judgment call this session made (Session 17's `OrganizationInvitation`
  has no platform-role column) — if a future session wants the invitee's
  intended platform role to be a durable, auditable part of the invitation
  itself rather than a link-construction detail, that's a schema
  decision for whoever owns it next, not silently changed here.
- No rate limiting on `/register` itself (Session 16's rate limiting
  covers `/login` specifically). Same category of gap already flagged for
  a future public "forgot password" page — not addressed here, out of
  this session's scope.

## Blockers

- **Live email delivery** — blocked on Session 19's transactional email
  provider. The contract (`sendMail()`) is fully defined and every caller
  (invitations here, password reset already) is wired to it; only the
  underlying implementation is a stub. Does not block the registration/
  join/invite flow itself — the invite link is always available to the
  inviting org_admin via the cookie relay regardless of delivery.
