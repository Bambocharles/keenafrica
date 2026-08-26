# Admin console (Session 03)

The administrative control plane over Session 02's Role/Permission model.
Extends the pre-existing admin login/dashboard/sponsor UI (`src/app/admin/**`)
— no second admin auth path, no parallel permission system.

## Access model

`src/app/admin/(protected)/layout.tsx` no longer gates on `User.isSuperAdmin`
alone. The console-shell entry check is `canAccessAdminConsole()`
(`src/lib/authz.ts`):

```ts
isSuperAdmin === true || roles includes "ADMIN" or "TROUBLESHOOTER"
```

This is **only** the coarse "can see the console" gate — every page and
every Server Action inside still calls its own
`requirePermission()`/`requireOwnResourceOrPermission()`/
`canActOnOwnResource()` (Session 02's `src/lib/authz.ts` contract). A
TROUBLESHOOTER reaching the layout does not imply it can do anything beyond
its actual (narrower) permission set — verified live: a TROUBLESHOOTER
session was used to attempt a direct crafted POST to suspend a user and to
toggle a feature flag; both were rejected server-side with the target state
unchanged, even though neither action's button is rendered for that role.

`SUPER_ADMIN` role-label holders are *not* automatically real super-admins —
`User.isSuperAdmin` (set only by `prisma/seed/tasks/super-admin.ts` or a
direct SQL update) remains the actual RLS bypass. The `SUPER_ADMIN` role
label is intentionally excluded from every assignable-role UI in this
session (user creation, role assignment) to avoid suggesting otherwise.

## Routes

| Route | Purpose | Read gate | Write gate |
|---|---|---|---|
| `/dashboard` | Sponsors/projects (pre-existing) + system status + Education Core entry-point stub | any console role | sponsor/project create: `isSuperAdmin` only (Sponsor Core has no permission keys yet — Session 11) |
| `/users` | User directory: search/filter (role, status)/pagination; create user | `users.read` | create: `users.create` |
| `/users/[id]` | Profile view/edit, role assign/remove, suspend/reinstate, sessions + revoke, password-reset trigger | `users.read` | see per-action table below |
| `/audit` | Security/audit event log: filter by action/entityType, pagination | `audit.read` | — (append-only, no UI write path) |
| `/flags` | Feature flag toggles over Session 01's `feature_flags` table | public (flags are non-secret) | `flags.manage` |
| `/reset-password` | Public: consumes a password-reset token, sets a new password | public (token is the proof) | — |
| `/login` | Pre-existing; redirect guard widened to `canAccessAdminConsole()` | public | — |

### `/users/[id]` action → permission map

| Action | Gate |
|---|---|
| Edit name | `canActOnOwnResource(actor, targetId, users.update)` — self or holder |
| Suspend / reinstate | `users.suspend` (never self-servable, even for a super-admin acting on their own account — matches `suspendUser()`'s existing contract) |
| Assign / remove role | `roles.manage` |
| Generate password-reset link | `canActOnOwnResource(actor, targetId, users.update)` — self or holder |
| Revoke one session / revoke all sessions | `canActOnOwnResource(actor, targetId, sessions.revoke)` — self or holder |

## New permission: `flags.manage`

Added to `PERMISSIONS`/`DEFAULT_ROLE_PERMISSIONS` in `src/lib/authz.ts`
(`ADMIN`/`SUPER_ADMIN` only — `TROUBLESHOOTER` stays diagnostics-only, no
config-mutation permissions). Migration
`20260826140000_admin_feature_flags_permission` widens
`feature_flags`'s `UPDATE` RLS policy from super-admin-only to
super-admin-OR-`flags.manage`, mirroring the `users_select` extension
pattern from Session 02. `INSERT`/`DELETE` stay super-admin-only — this
session's UI only ever toggles `enabled` on an existing row; the flag *set*
is still defined in code (`FEATURE_FLAGS`) and materialized by the seed.

Verified against the real non-superuser RLS test role
(`src/lib/rls.integration.test.ts`), not just the application-layer check.

## APIs/contracts added this session

All additive extensions to existing Session 01/02 modules — no new tables,
no parallel systems:

- `src/lib/users.ts`: `listUsers(filter, actor)` (search/role/status
  filter + pagination, requires `users.read`), `getUserById(id, actor)`
  (requires `users.read`).
- `src/lib/audit.ts`: `listAuditEvents(filter, actor)` (action/entityType/
  actorId filter + pagination, requires `audit.read`).
- `src/lib/feature-flags.ts`: `listFeatureFlags()` (public),
  `setFeatureFlag(key, enabled, actor)` (requires `flags.manage`, busts the
  in-process cache immediately, records a `feature_flag.updated` audit
  event).
- `src/lib/password-reset.ts`: `requestPasswordReset()` gained an optional
  trailing `triggeredByActorId` param — when set, the resulting
  `password_reset.requested` audit event's `actorId` is the triggering
  admin (not the target user) with `metadata: { triggeredByAdmin: true }`,
  so an admin-initiated reset is distinguishable from genuine self-service.
  Fully backward compatible — every existing call site omits it.
- `src/lib/admin-stats.ts` (new file): `getSystemStatus(actor)` — read
  aggregate (user counts by role/status, active session count, feature
  flag on/off count, sponsor/project count) powering the dashboard's
  "System status" panel. Requires `users.read`.
- `src/lib/authz.ts`: `ADMIN_CONSOLE_ROLES`, `canAccessAdminConsole()`,
  `PERMISSIONS.FLAGS_MANAGE`.

## Fixed while extending the layout guard

`DashboardPage` (`src/app/admin/(protected)/dashboard/page.tsx`) called
`withRls({ userId: user.id, isSuperAdmin: true }, ...)` — **hardcoded**
`isSuperAdmin: true` regardless of the actual caller. Harmless while the
layout only ever admitted real super-admins, but would have silently
granted a full RLS bypass to every ADMIN/TROUBLESHOOTER the moment the
layout guard widened. Fixed to pass the actor's real `isSuperAdmin`/
`permissions`. The sponsor/project *create* forms are now conditionally
rendered only for `user.isSuperAdmin` (Sponsor Core write access has no
permission model yet), so a non-super-admin no longer sees a button that
would 500 on submit.

## Password reset — no email provider yet (carried-forward blocker)

Session 02 left `src/lib/mailer.ts`'s `sendMail()` as a dev-console-log
stub (throws in production — see its docstring and Session 02's handoff
Blockers). The admin-triggered "generate password reset link" action
(`/users/[id]`) calls it as a courtesy but does not depend on it: the raw
one-time link is also stashed in a short-lived (60s), `httpOnly`,
path-scoped cookie and shown directly to the *authorized admin who
triggered it* to relay out of band. This is safe (only the permission-
holding admin's own browser sees it; the underlying token is already
single-use and DB-expires in 1h regardless) but is a stopgap — a public
self-service "forgot password" page was deliberately **not** built this
session, because without real email delivery there is no safe way to
return the token to an unauthenticated requester (whoever asks would
receive anyone's reset link — an account-takeover primitive). That page is
still blocked on Session 02's "no transactional email provider" blocker.

The `/reset-password` token-consumption page **was** built (public, no
auth) since it's required to make the admin-triggered flow actually
usable end to end, and consuming a token is safe pre-auth by design
(possession of the raw token is the proof).

## Known limitations

- User creation sets a temporary password directly (admin types it in) —
  there is no invite-by-email flow (blocked on the same missing email
  provider).
- No Users bulk actions (bulk-suspend, bulk role change).
- Sponsor/project management is unchanged from the pre-existing UI
  (create-only, super-admin-gated) — full Sponsor Core CRUD is Session 11.
- Education Core dashboard section is a placeholder card, not a built
  feature — Session 04 owns it.
- `getUserById`/`listUsers` are gated on `users.read` (not an ownership
  bypass) — today every `ADMIN_CONSOLE_ROLES` role holds `users.read`, so
  there's no practical gap, but a future admin-console role without it
  would not be able to view even its own profile through these functions.
