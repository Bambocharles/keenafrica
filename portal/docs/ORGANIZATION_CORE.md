# Organization Core (Session 17)

A fourth pillar alongside Platform/Education/Sponsor Core
(`PLATFORM_ARCHITECTURE.md` §14): a general membership/tenant boundary for
teachers/students — a school, church, company, NGO, training center, or an
individual's personal (B2C) space. **Deliberately separate from Sponsor
Core** (a funding/project relationship) — not merged, renamed, or made a
parent of it. Both decisions were final before this session started; see
`PLATFORM_CONTEXT.md`'s "Organization/Tenant model" section.

Two things this session explicitly does **not** build (owned by later
sessions, see their own docs when written):
- the self-service signup/registration UI that creates an organization or
  requests to join one — Session 18.
- making `Course`/`Cohort`/`Enrollment` organization-aware — Session 21.

## Data model

- `Organization` — `id`, `name`, `slug` (unique), `type` (extensible
  metadata: `school` / `church` / `company` / `ngo` / `training_center` /
  `government` / `university` / `community` / `personal` / `other` — not
  part of the permission system), `status` (`pending` / `active` /
  `suspended` / `archived`, defaults to `active` — see "Why status defaults
  to active" below), `verifiedAt` (a separate, optional platform-
  verification signal), `description`/`logoUrl`/`contactEmail`/
  `contactPhone`, `createdBy`.
- `OrganizationMembership` — the **only** path from a `User` to an
  `Organization`. `organizationId`, `userId`, `role` (`org_admin` /
  `org_member` — org-scoped, distinct from the global Role/Permission
  model), `status` (`invited` / `pending` / `active` / `suspended` /
  `removed`), `invitedBy`, `joinedAt`. `@@unique([organizationId, userId])`
  — one row per user per org; status/role carry the full lifecycle rather
  than deleting and recreating rows.
- `OrganizationInvitation` — the email-based invite path, works even
  before the invitee has a platform account. `organizationId`, `email`,
  `role` offered, `tokenHash` (raw token returned once, SHA-256-hashed at
  rest — same shape as `PasswordResetToken`), `status` (`pending` /
  `accepted` / `revoked` / `expired`), `invitedBy`, `expiresAt` (14 days).

**No `organizationId` column on `User`, anywhere.** A person may belong to
zero, one, or many organizations — this is final, not open for
reconsideration (`PLATFORM_CONTEXT.md`).

### Why `status` defaults to `active`

A self-service-created organization (Session 18's "create a new
organization, become its owner" flow) must be immediately usable by its
creator — the same expectation a B2C individual account already gets.
`verifiedAt` is the separate, optional platform-verification signal
(`PLATFORM_DATA_MODEL.md` lists status and verification as distinct
fields); nothing in this session gates on it. A future session that wants
"new orgs start `pending` until platform review" can change the default
without touching the authorization model at all.

## Authorization model

Two layers, mirroring `sponsor.ts`'s "permission + ownership row" shape:

| Layer | Answers | Mechanism |
|---|---|---|
| Global | "What can this person do on Keen Africa" | `PERMISSIONS.ORGANIZATIONS_MANAGE` (`organizations.manage`) — `ADMIN`/`SUPER_ADMIN` hold it via `ALL_PERMISSION_KEYS`. A Platform Admin's reach into **every** organization, unconditionally. |
| Org-scoped | "What can this person do inside THIS organization" | `OrganizationMembership.role` — `org_admin` manages exactly one organization (its own); `org_member` is a plain member, no management rights. |

These are deliberately never collapsed into one enum — a Platform Admin's
cross-tenant reach must not be diluted by, or confused with, an
Organization Admin's reach limited to their own org.

`requireOrgPermission(organizationId, actor, minRole)` (`src/lib/
organizations.ts`) is the shared gate every mutating/management function in
this module goes through — the org-scoped analog of `authz.ts`'s
`requirePermission()`. `super_admin`/`organizations.manage` bypass it
entirely; otherwise it requires an **ACTIVE** `OrganizationMembership` row
in that specific organization, at least at `minRole` (`"org_member"` by
default, `"org_admin"` for management actions).

No `TEACHER`/`STUDENT`/`SPONSOR_*` global Role holds `organizations.manage`
by default — organization-scoped capability comes entirely from
`org_admin` membership, never from a global Role.

## Membership lifecycle

```
requestToJoinOrganization  ──►  pending  ──► approveJoinRequest ──► active
                                    │
                                    └──► rejectJoinRequest ──► removed

inviteToOrganization (known user) ──► invited ──► acceptOrganizationMembershipInvite ──► active
inviteToOrganization (unknown email) ──► OrganizationInvitation(token) ──► acceptOrganizationInvitation ──► active

active ──► suspendMembership ──► suspended ──► reinstateMembership ──► active
any    ──► removeMembership ──► removed   (self "leave", or an org_admin removing someone)
```

**Membership is always gated** — this session's own explicit Rule, tested
at both the application layer (`organizations.test.ts`) and the RLS layer
(`rls.integration.test.ts`):

- `requestToJoinOrganization()` only ever creates a `pending` row for the
  caller **themselves** — never `active`. Nobody can grant themselves
  active membership merely by supplying an organization id.
- `inviteToOrganization()`/`acceptOrganizationInvitation()` are the only
  paths that move a row to `active` for someone who isn't already an
  `org_admin`/`organizations.manage` holder acting on their own org — and
  both require an `org_admin` (or `organizations.manage`) to have
  initiated the invite first.
- The organization's **founder** becomes its first `org_admin`,
  `active`, `joinedAt` set immediately, in the same transaction as
  `createOrganization()`'s `INSERT` — see the migration's dedicated RLS
  `WITH CHECK` branch for exactly why that one case is authorized despite
  no prior membership existing yet.

**Last-admin guard**: `suspendMembership`/`removeMembership`/
`changeMemberRole` all refuse to leave an organization with zero active
`org_admin` members — an org can never be orphaned by a single admin
suspending, leaving, or demoting themselves.

## RLS: `app.organization_ids` and `app.org_invitation_lookup`

Two new session variables, set by `withRls()` (`src/lib/rls.ts`) alongside
the existing `app.user_id`/`app.is_super_admin`/`app.permissions`:

- **`app.organization_ids`** — a server-resolved JSON array of the
  organization ids the caller holds an **ACTIVE** membership in (any
  role). Resolved in `src/lib/sessions.ts`'s `resolveSessionAuthz()` —
  the exact same place, and the exact same re-validated-every-request
  cadence, as roles/permissions — and flows through the JWT (`src/lib/
  auth.ts`'s `jwt`/`session` callbacks) into `session.user.organizationIds`
  (`src/types/next-auth.d.ts`). **Never trust an organization id supplied
  by the client** — this array is always resolved server-side from the
  `organization_memberships` table itself, the same way `app.permissions`
  is resolved from `role_permissions`, never accepted as a request
  parameter.

  RLS policies test membership with a `jsonb_array_elements_text`
  expression (this is a set of ids, not a set of jsonb object keys, so the
  `app.permissions` convention's `?` key-existence operator doesn't apply
  here):

  ```sql
  "organization_id"::text = ANY (
    SELECT jsonb_array_elements_text(
      coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb
    )
  )
  ```

  **Session 21 (Organization-Aware Education) reuses this exact
  expression** against `Course`/`Cohort`/`Assessment`/`Question` once those
  gain `organizationId`.

- **`app.org_invitation_lookup`** — set ONLY by `organizations.ts`'s
  `acceptOrganizationInvitation()`, for the token-authorized (not
  `app.user_id`/`app.organization_ids`-authorized) invitation lookup/
  consume and the resulting `organization_memberships` row it creates.
  Mirrors the existing `app.password_reset_lookup` convention exactly —
  the accepting user isn't already an `org_admin`/`organizations.manage`
  holder for this org; the invitation itself (already created by one) is
  the authorization.

### `app_current_user_admin_organization_ids()`

A `SECURITY DEFINER` SQL function (same convention as `app_current_user_
sponsor_project_ids()`/`app_current_user_conversation_ids()`), returning
the set of organization ids where the caller holds an **ACTIVE
`org_admin`** membership. Needed because "does the caller hold org_admin
in org X" is a self-referencing check against `organization_memberships`
from within that same table's own policy — the same recursion trap
documented in the `messaging_core`/`sponsor_core` migrations. Running as
the table owner (bypasses RLS internally) avoids re-triggering the policy
it's used from. Used by every "org_admin manages their own org" branch
across all three tables' policies.

### Policy shapes (see the `organization_core` migration for the exact SQL)

| Table | SELECT | WRITE | UPDATE | DELETE |
|---|---|---|---|---|
| `organizations` | super_admin / `organizations.manage` / any authenticated user (non-archived) / own org via `app.organization_ids` | `created_by = self` (or manage/super_admin) | `organizations.manage` / super_admin / org_admin of that org | none — archive, don't delete |
| `organization_memberships` | super_admin / manage / self row (any status) / org_admin of that org (any status, via the SECURITY DEFINER helper) / active roster of an org the caller is active in | org_admin of that org (any row) / self at `status='pending'` only / the founder's own `org_admin`+`active` row for an org they just created / `org_invitation_lookup` | super_admin / manage / org_admin of that org / self (app-layer restricts *which* transition self may make — RLS is row-level, not value-level, same documented limitation as `users_update`) | none — remove via `status='removed'` |
| `organization_invitations` | super_admin / manage / org_admin of that org / `org_invitation_lookup` / caller's own email matches | org_admin of that org / manage / super_admin (never self-issued) | same actors as WRITE, plus `org_invitation_lookup` (marking accepted during redemption) | none |

**Verified against the real non-superuser `portal_rls_test` role**
(`RLS_TEST_DATABASE_URL`, see `docs/IDENTITY_SECURITY.md`'s "Testing RLS
for real"), not just application-layer tests — `src/lib/
rls.integration.test.ts`'s "Organization Core (Session 17)" block:
unauthenticated visibility, cross-org isolation for an org_admin
(`organization_memberships_select`/`organization_invitations_select`),
the self-granted-`active`-row rejection, `created_by` spoofing rejection,
and the no-DELETE-policy guarantee.

## API surface (`src/lib/organizations.ts`)

- `createOrganization(input, actor)` — any authenticated actor; founder
  becomes `org_admin`.
- `updateOrganizationSettings(id, input, actor)` — org_admin of that org,
  or manage/super_admin. Profile fields only, never `status`.
- `setOrganizationStatus(id, status, actor)` — manage/super_admin **only**,
  deliberately not delegable to an org_admin.
- `getOrganizationById(id, actor)`, `listOrganizations(filter, actor)`
  (manage/super_admin, paginated admin-console directory),
  `listMyOrganizations(actor)` (self-scoped, any status except removed).
- `listOrganizationMembers(organizationId, actor)` — org_admin of that org,
  or manage/super_admin. Full roster, every status.
- `requestToJoinOrganization`, `approveJoinRequest`, `rejectJoinRequest`,
  `suspendMembership`, `reinstateMembership`, `removeMembership`,
  `changeMemberRole` — see "Membership lifecycle" above.
- `inviteToOrganization(organizationId, email, role, actor)` — org_admin
  of that org, or manage/super_admin. Returns
  `{ mode: "existing_user", membershipId, userId }` or
  `{ mode: "email_invitation", invitationId, token }` (raw token, once,
  same "returned only at generation time" contract as
  `requestPasswordReset`).
- `acceptOrganizationMembershipInvite(membershipId, actor)` — self, or
  org_admin/manage acting on the invitee's behalf.
- `acceptOrganizationInvitation(rawToken, actor)` — token-based, any
  authenticated actor (including one Session 18 just registered).
- `revokeOrganizationInvitation`, `listOrganizationInvitations` — org_admin
  of that org, or manage/super_admin.

Every mutating function calls `recordAuditEvent()` (actions:
`organization.created`/`updated`/`status_changed`,
`organization_membership.requested`/`approved`/`rejected`/`invited`/
`accepted`/`suspended`/`reinstated`/`removed`/`role_changed`,
`organization_invitation.created`/`revoked`) and emits `OrganizationCreated`
/ `OrganizationMembershipChanged` (`src/lib/events.ts`).

## Admin console

`/admin/organizations` (list + create, `organizations.manage`-gated) and
`/admin/organizations/[id]` (settings, status lifecycle, member roster +
approve/reject/suspend/reinstate/remove/role-change, invite-by-email,
pending-invitation list + revoke). This is the Platform Admin's oversight
surface — deliberately minimal (per this session's scope: "UI can be
minimal; Session 18 owns the full onboarding UX"). Self-service
organization creation/join/invite UX for a plain teacher/student acting as
their own org's `org_admin` is Session 18's job; the backend contract
above already supports it fully.

## Testing

- `src/lib/organizations.test.ts` — application-layer: authorization
  boundaries (`requireOrgPermission` at both levels, Platform Admin
  bypass), cross-organization isolation (an org_admin of A cannot manage
  or even list B; a user with active memberships in two orgs is scoped
  correctly to each), the full membership lifecycle including the
  last-admin guard, both invitation paths (existing user vs. email token,
  including single-use redemption), and domain events.
- `src/lib/rls.integration.test.ts`'s "Organization Core (Session 17)"
  block — the same boundaries proven against the real non-superuser role,
  not just application code. See "RLS" above for exactly what's covered.

## Known limitations

- No public-facing UI for join-request/invite-accept flows — Session 18's
  job; the backend contracts are complete and tested.
- `inviteToOrganization`'s email delivery for the token path is not
  wired to anything (no transactional email provider exists in this infra
  yet — same `src/lib/mailer.ts` gap `docs/IDENTITY_SECURITY.md` already
  documents for password reset). The raw token is returned to the caller,
  same as `requestPasswordReset`; delivering it is Session 19's job.
- A plain `org_member`'s roster visibility (RLS's "active roster of an org
  the caller is active in" branch) is deliberately not exposed through any
  `organizations.ts` function yet — `listOrganizationMembers` requires
  `org_admin`. A lighter "see my colleagues" read for plain members is
  left for whichever session's UX actually needs it (likely Session 18).
- `Organization.status` transitions are manage/super_admin only; there is
  no self-service "archive my own org" path in this session — a deliberate
  choice to keep platform-level lifecycle out of org_admin's reach, not an
  oversight.
