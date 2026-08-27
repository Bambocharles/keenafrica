# Sponsor Core (Session 11)

Sponsor-facing project visibility, built on the Phase-1 `Sponsor`/`Project`/
`ProjectMembership` scaffold already present in `schema.prisma` before this
session — extended, not replaced (`CLAUDE_BUILD_RULES.md` §2/§3).

## Portal

`sponsor.<domain>` — same subdomain-rewrite pattern as `admin.`/`teacher.`/
`student.` (`src/middleware.ts`). Login reuses the shared `Auth.js`
Credentials setup (`src/lib/auth.ts`) — no separate authentication system,
no separate `User` model.

- `/dashboard` — every project the actor's sponsor team is on, with
  milestone/beneficiary/document counts.
- `/projects` — the same list as a plain table.
- `/projects/[id]` — full detail: status/description/dates, milestones,
  impact metrics, beneficiary count + privacy-scoped roster, documents
  (download links), and the sponsor team roster + invite/remove (if
  `sponsor.users.manage`).
- `/profile`, `/notifications` — reused verbatim from the teacher portal's
  generic, actor-based implementations (no sponsor-specific logic needed).
- `/assets/[id]/download` — reuses Session 13's `assetDownloadResponse()`.

## Authorization model

Rebuilt on Session 02's Role/Permission model instead of the old
`MembershipRole` enum's ad hoc checks — the same "permission + ownership
row" shape Education Core uses (`courses.content.write` +
`cohort_teachers`).

### Roles (Session 02, pre-seeded, previously empty)

| Role | Default permissions |
|---|---|
| `SPONSOR_ADMIN` | `sponsor.projects.read`, `sponsor.users.manage` |
| `SPONSOR_USER` | `sponsor.projects.read` |

`canAccessSponsorPortal(actor)` (`src/lib/authz.ts`) is the coarse
"can see the sponsor portal shell" gate — holding either role alone grants
**nothing** without a matching `ProjectMembership` row (see below), same as
`TEACHER` holding `courses.content.write` with no `cohort_teachers` row.

### Permissions

| Key | Meaning |
|---|---|
| `sponsor.manage` | Admin/staff full management: sponsors, projects, milestones, metrics, documents, any project's membership. `ADMIN`/`SUPER_ADMIN` hold it via `ALL_PERMISSION_KEYS`. |
| `sponsor.projects.read` | Necessary but not sufficient — see ownership below. |
| `sponsor.users.manage` | Lets a project's own sponsor-team member invite/remove **another** sponsor-team member on that same project. |

### Ownership: `ProjectMembership.role = 'sponsor_admin'`

A `project_memberships` row with `role='sponsor_admin'` is the "sponsor-
side project team" relationship — the direct analogue of `cohort_teachers`.
It is **orthogonal** to the global `SPONSOR_ADMIN`/`SPONSOR_USER` Role: the
global Role controls *capability* (manage vs. read-only), this row controls
*which projects* a sponsor-side user can see at all. Both a `SPONSOR_ADMIN`
and a `SPONSOR_USER` need this row to see a given project. (The enum value
name predates this session's Role/Permission rebuild and is kept as-is per
"extend, don't replace the Phase-1 scaffold" — see its doc comment in
`schema.prisma`.)

`ProjectMembership.role = 'beneficiary'` is the separate, pre-existing
beneficiary link — see Privacy below.

`src/lib/sponsor.ts`'s `isProjectSponsorMember()` /
`requireProjectSponsorAccess()` are the direct analogue of
`courses.ts`'s `isCourseTeacher()` / `requireCourseContentAccess()`.
`super_admin` and `sponsor.manage` holders bypass ownership entirely.

### Sponsor team self-service (`addProjectTeamMember`)

Two authorized paths:

- **`sponsor.manage` (admin/staff)**: adds an *existing* platform user (by
  exact email — never creates a new `User` row) to the project's sponsor
  team, and also grants them the `SPONSOR_USER` Role via
  `users.ts`'s `assignRole()` if they hold neither sponsor Role yet. Safe
  because `sponsor.manage` holders already hold `roles.manage` too.
- **`sponsor.users.manage` + ownership** (a sponsor-team member acting on
  their own project): adds the membership row only. Never touches
  `roles.manage`-gated Role assignment (Admin-only, least privilege) — the
  result's `needsRoleGrant: true` tells the UI the new member still needs
  an administrator to grant them a sponsor Role before they can reach the
  portal at all. This is a real, deliberate limitation, not an oversight —
  see Known limitations.

Neither path can ever create a `role='beneficiary'` row — beneficiary
placement is admin-only (`addProjectBeneficiary`, `sponsor.manage`), never
sponsor self-service.

## Privacy: beneficiaries (`Must NOT expose sensitive student information`)

A `ProjectMembership` row alone carries no PII (just `user_id`/
`project_id`/`role`), so RLS granting a sponsor-team member visibility into
`project_memberships` rows is safe on its own. The risk is joining from
there into `users`. `users_select`'s RLS only grants a non-super-admin/
non-`users.read` caller their **own** row — a sponsor correctly does not
hold that for a beneficiary.

`listProjectBeneficiaries()`/`getProjectBeneficiaryCount()`
(`src/lib/sponsor.ts`) therefore:

1. Run `requireProjectSponsorAccess()` first (permission + ownership).
2. Only then read `users` under an internal `SYSTEM_CTX` (bypasses RLS,
   same "already-authorized caller" pattern as `sessions.ts`'s
   `revokeAllUserSessionsAsSystem`/`notifications.ts`'s `SYSTEM_CTX`).
3. Project a deliberately minimal shape: `{ id, displayName }`, where
   `displayName` is first-name + last-initial only
   (`anonymizedDisplayName()`). **Never** email, phone, enrollment status,
   assessment/academic data, notes, or messages.

RLS is a row-level backstop, not column-level (documented limitation since
Session 02) — widening `users_select` instead would hand a sponsor the
beneficiary's **full row**, including `password_hash`. This narrow,
explicit application-layer projection is the actual privacy control.

The sponsor team roster (`listProjectTeam`) is **not** anonymized — those
are the sponsor org's own colleagues (full name + email), not students.

## Data model additions

All additive to the Phase-1 scaffold (migrations `20260827150000_sponsor_core`,
`20260827160000_sponsor_asset_attachments`, `20260827170000_sponsor_project_fields`):

- `Project` gains `description`/`startDate`/`endDate` (per
  `PLATFORM_DATA_MODEL.md`'s Project contract — the scaffold only had
  name/slug/status).
- `Milestone` (new) — `projectId`, `title`, `description`, `targetDate`,
  `status` (`planned`/`in_progress`/`achieved`/`missed`), `achievedAt`.
  Admin-authored (`sponsor.manage`), read-only for the sponsor portal.
  Emits `ProjectMilestoneUpdated` (pre-typed since Session 01, unemitted
  until now) on create/update — Session 10's notification listener was
  already subscribed and waiting.
- `ProjectMetric` (new) — point-in-time impact samples (`label`, `value`,
  `unit`, `recordedAt`), not a running total. Append-only (no update/delete
  RLS policy). `getProjectImpactSummary()` is the Session 12 (Reporting &
  Impact) reporting hook: latest sample per label + sample count.
- `ProjectDocument` (new) — the anchor row for a `sponsor_document` Asset
  attachment, the same shape `Resource` plays for `lesson_resource`
  (Session 13's `@@unique([entityType, entityId])` 1:1 convention needs one
  anchor row per file; a project needs many documents over time).
- `AssetEntityType` gains `sponsor_document` (its `asset_attachments` RLS
  branch landed in a separate migration — a new enum value can't be used in
  the same transaction that adds it, same constraint Session 09 documented
  for `'message'`).

## RLS

`sponsors`/`projects`/`project_memberships` widened off `is_super_admin`-
only to `is_super_admin OR sponsor.manage`, plus ownership branches via a
new `SECURITY DEFINER` helper, `app_current_user_sponsor_project_ids()`
(same convention as `app_current_user_conversation_ids()`/
`app_current_user_enrolled_cohort_ids()`) — required because
`project_memberships_select` needs to check `project_memberships` itself
(a genuine self-reference, the same "infinite recursion detected in
policy" failure class Sessions 08/09/13 already documented).

`milestones`/`project_metrics`/`project_documents` are new, RLS-protected
from the start: `sponsor.manage`/`super_admin` full access, a project's own
sponsor team read-only.

See `src/lib/sponsor-rls.integration.test.ts` for the actual
Postgres-enforcement proof (against the real non-superuser
`portal_rls_test` role) — including the cross-sponsor isolation case this
session's acceptance criteria call out explicitly, and the
`asset_attachments`/`project_documents` cascade for sponsor documents.

## Known limitations

- **Milestones/metrics/documents are admin-authored, sponsor-read-only in
  this session.** The brief's dashboard bullets ("milestones",
  "reports/documents") describe a visibility surface; sponsor-side
  authoring wasn't a stated acceptance criterion. Extending write access to
  `sponsor.users.manage` holders (ownership-scoped, same shape as the team
  invite) is a small, additive follow-up if a later session needs it.
- **A sponsor-invited colleague may need a separate admin step.** The
  self-service `sponsor.users.manage` path adds the project membership but
  cannot grant the `SPONSOR_ADMIN`/`SPONSOR_USER` Role (that needs
  `roles.manage`, Admin-only, deliberately). Until an admin grants one via
  the existing `/admin/users/[id]` role-assign UI (Session 03, no new work
  needed there), the invited person can log in (shared identity) but
  `canAccessSponsorPortal()` denies them the portal shell. The UI surfaces
  this via `needsRoleGrant`/a banner rather than hiding it.
- **No sponsor self-service "forgot password."** Same rationale/blocker as
  every other portal (Session 02's email-provider blocker, still open).
- **Local dev's default `DATABASE_URL` is the Postgres superuser**
  (documented repeatedly since Session 02), which bypasses RLS entirely —
  a manual live check of `sponsor_document` download authorization against
  the running dev server therefore could not, by itself, prove the RLS
  cascade; `src/lib/sponsor-rls.integration.test.ts` (against the real
  non-superuser role) is what actually proves it, and does.
