# Identity, authorization, sessions, and security (Session 02)

Canonical identity/authz foundation for every portal. Extends the existing
`User` + Auth.js credentials setup from Session 01 — does not replace it.

## Identity model

- `User.isSuperAdmin` (unchanged) remains the root bypass, baked into every
  table's RLS policies. It is not replaced by the role/permission system
  below — it's the escape hatch beneath it.
- `Role` / `Permission` / `RolePermission` / `UserRole` — additive,
  finer-grained authorization for non-super-admin actors. Seeded roles
  (`src/lib/authz.ts`'s `ROLE_NAMES`, materialized by
  `prisma/seed/tasks/roles-permissions.ts`): `SUPER_ADMIN`, `ADMIN`,
  `TROUBLESHOOTER`, `TEACHER`, `STUDENT`, `SPONSOR_ADMIN`, `SPONSOR_USER`.
  A user can hold more than one role.
- `User.status` (`active` | `suspended`) + `suspendedAt`. Suspension blocks
  new logins (`authorize()` in `src/lib/auth.ts`) and revokes every
  existing session (`suspendUser()` in `src/lib/users.ts`).

## Permissions

Action-oriented keys, `src/lib/authz.ts`'s `PERMISSIONS`:

| key | meaning |
|---|---|
| `users.read` | view user accounts |
| `users.create` | create new user accounts |
| `users.update` | edit another user's profile |
| `users.suspend` | suspend/reinstate a user account |
| `roles.manage` | assign/remove a role on a user (NOT define what a role can do — see below) |
| `sessions.read` | view another user's active sessions |
| `sessions.revoke` | revoke another user's session(s) |
| `audit.read` | read the audit event log |

Only permissions for capabilities that exist today are seeded. Education/
Sponsor Core sessions (courses.*, assessments.*, sponsor.*, ...) add their
own keys the same way when they build those entities — extend
`PERMISSIONS`/`DEFAULT_ROLE_PERMISSIONS` and
`prisma/seed/tasks/roles-permissions.ts`, don't build a parallel table.

**Privilege-escalation boundary**: `roles.manage` lets a holder assign an
*existing* role to a user. It does NOT let them write `role_permissions`
(what a role means) — that's super-admin only, enforced at the RLS layer,
so an ADMIN can never grant themselves a new capability by editing a role's
definition.

Default role → permission mapping is `DEFAULT_ROLE_PERMISSIONS` in
`src/lib/authz.ts`. `TROUBLESHOOTER` is deliberately narrower than `ADMIN`
(read + session revocation only — no `users.update`/`users.suspend`/
`roles.manage`), per the session brief's "least-privilege diagnostic
capabilities."

## Using authorization in code

```ts
import { requirePermission, requireOwnResourceOrPermission, PERMISSIONS } from "@/lib/authz";

// Actor-only gate — never bypassed by self-ownership (e.g. suspension):
requirePermission(actor, PERMISSIONS.USERS_SUSPEND);

// Self OR permission-holder (e.g. profile edits, session management):
requireOwnResourceOrPermission(actor, targetUserId, PERMISSIONS.USERS_UPDATE);
```

`actor` is `{ id, isSuperAdmin, permissions }` — in a request handler this is
`session.user` (see `src/types/next-auth.d.ts`); in a script/seed context,
build it however's appropriate (see `src/lib/test-support.ts`'s
`actorFromUser()` for the test-fixture version).

**This is the primary, fine-grained authorization gate.** RLS (below) is a
coarse backstop, not a replacement — it cannot restrict *which columns* an
UPDATE touches (e.g. a `users.suspend` holder is DB-permitted to update any
column on a `users` row, not just `status`/`suspended_at`), so always check
permissions in application code, not RLS policies alone.

## Row-Level Security

New session var: `app.permissions` — a JSON array of the caller's resolved
permission keys, set by `withRls()` alongside the existing `app.user_id`/
`app.is_super_admin`. Policies test membership with jsonb `?`, e.g.:

```sql
coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sessions.revoke'
```

**RETURNING pitfall** — Postgres RLS enforces the SELECT policy on any row
returned by INSERT/UPDATE/DELETE, and Prisma's `.create()`/`.update()`
always do `RETURNING`. Two real bugs from this were caught by
`rls.integration.test.ts` (which runs against a real non-superuser role,
unlike the default local dev DB — see below) and fixed:

1. `recordAuditEvent()` uses `tx.$executeRaw` for a plain `INSERT` with no
   `RETURNING`, specifically to avoid this — see the comment in
   `src/lib/audit.ts`.
2. `users_select`/`sessions_select` policies also grant read visibility to
   holders of the *write* permission on that table (`users.create`/
   `users.update`/`users.suspend`, `sessions.revoke`) — otherwise a
   write-only custom role's own mutations would fail on the RETURNING
   step. If you add a new writable table gated by a permission, check
   whether its SELECT policy needs the same treatment before assuming a
   passing test with a role that happens to hold both permissions proves
   anything.

### Testing RLS for real

The default local dev `DATABASE_URL` (see `README.md`) connects as the
Postgres **superuser**, which always bypasses RLS regardless of policies —
so most tests in this repo (including this session's `sessions.test.ts`/
`users.test.ts`/`password-reset.test.ts`) exercise application-layer
authorization only, not the DB-level backstop.

`scripts/dev/create-rls-test-role.sql` creates a real non-superuser role
(`portal_rls_test`) for this. One-time setup:

```bash
docker exec -i <your-dev-pg-container> psql -U postgres -d portal_dev \
  < scripts/dev/create-rls-test-role.sql
export RLS_TEST_DATABASE_URL=postgresql://portal_rls_test:portal_rls_test_dev_only@localhost:55432/portal_dev
```

`src/lib/rls.integration.test.ts` skips (not fails) when
`RLS_TEST_DATABASE_URL` is unset. Run it whenever you touch an RLS policy —
it is the only thing in this repo that actually proves the backstop holds.

## Sessions and revocation

Sessions are JWT-strategy (Auth.js requires this for the Credentials
provider — a DB `session` strategy isn't an option here), but each JWT
carries only a `sessionId` pointing at a real `sessions` row
(`src/lib/sessions.ts`). The `jwt` callback in `src/lib/auth.ts` re-validates
that row — and re-resolves current roles/permissions/suspension state — on
**every** request, not just at sign-in, via `resolveSessionAuthz()`.
Returning `null` from the callback invalidates the session immediately.

This means:
- `revokeSession(id, actor)` / `revokeAllUserSessions(userId, actor)` take
  effect on the target's very next request — no waiting for token expiry,
  no client-side logout needed.
- Suspending a user (`suspendUser()`) revokes every active session as part
  of the same operation, so the block is immediate.
- **Verified live, not just unit-tested**: logged in via a real
  `/auth/callback/credentials` request, confirmed the session cookie
  worked against a protected page, called `revokeSession()`, and confirmed
  the *identical* cookie was rejected on the very next request — see the
  Session 02 handoff entry in `status/project-status.md` for the exact
  repro.
- Cost: every `auth()` call now does 1–3 DB queries (session validity +
  user status + roles/permissions). Acceptable at current scale, same
  judgment call as `src/lib/events.ts`'s in-process bus — revisit if/when
  request volume makes it a real bottleneck.

`revokeAllUserSessionsAsSystem()` is an internal, non-permission-checked
variant for callers (like `suspendUser()`) that have already authorized
their own broader action — see its docstring before reusing it anywhere
else.

## Password reset

`src/lib/password-reset.ts`: `requestPasswordReset(email)` /
`resetPassword(token, newPassword)`. Single-use, SHA-256-hashed-at-rest,
1-hour-expiry tokens; a successful reset revokes every existing session.
`requestPasswordReset` returns the same shape (`{ token: null }`) for a
nonexistent email and a suspended account, so neither is distinguishable to
an unauthenticated caller.

**No UI pages and no real email delivery** — see Known limitations below.

## Audit

`recordAuditEvent()` (`src/lib/audit.ts`) writes to `audit_events`, which
has no UPDATE/DELETE RLS policy at all — once written, a record cannot be
altered or removed by any role through the application. Current emitters:
`login.succeeded`, `login.denied_suspended`, `session.revoked`,
`session.revoked_all`, `user.created`, `user.profile_updated`,
`user.suspended`, `user.reinstated`, `role.assigned`, `role.removed`,
`password_reset.requested`, `password_reset.completed`.

## Domain events

First real emitters into `src/lib/events.ts` (per Session 01's handoff):
`UserCreated` (from `createUser()`), `RoleChanged` (from `assignRole()`/
`removeRole()`), `UserSuspended` (from `suspendUser()`).

## Known limitations

- **No transactional email provider exists in this infra** — see
  `src/lib/mailer.ts`. `requestPasswordReset()` returns the raw token but
  delivering it is a dev-console-log stub. Wiring a real provider (choice
  of provider, API key, sender domain/DKIM) is an infra decision outside
  this session's authority — see Blockers in the Session 02 handoff.
- **No password-reset or "manage my sessions" UI pages.** The backend
  contract (`src/lib/password-reset.ts`, `src/lib/sessions.ts`'s
  `listSessions`/`revokeSession`) is complete and tested; wiring it into a
  page is for whichever session owns that portal surface.
- **RLS is a coarse, row-level backstop**, not column-level — see the
  "Using authorization in code" section above. Application code is the
  real gate for which fields a given permission may touch.

## Critical finding (unrelated to this session, discovered during E2E verification)

`middleware.ts` sits at the **project root**, but this repo uses a `src/`
layout (`src/app`, `src/lib`, ...). Next.js's file-convention resolution
does not detect a root-level `middleware.ts` when a `src/` directory is
present — it must be `src/middleware.ts` (Next 16 additionally deprecates
the name in favor of `proxy.ts`, i.e. `src/proxy.ts`; both were confirmed
to work in Next 16.2.11, `middleware.ts` with a one-time deprecation
warning). **As currently placed, `middleware.ts` never runs at all** — no
deprecation warning is even logged — meaning every subdomain-routing
rewrite (the entire `admin.` console and every tenant `{slug}.` page) 404s
in the current dev setup. Confirmed live: `Host: portal.local` returned the
generic Next.js HTML 404 page instead of `middleware.ts`'s own plain-text
`"Not found"` response, and moving a copy to `src/middleware.ts` fixed
subdomain routing immediately (verified, then reverted — routing/deploy
infra is outside Identity & Security's boundary).

This predates this session (middleware.ts wasn't touched) and is not
something this session fixes, per CLAUDE_BUILD_RULES.md §2 — reporting it
here and in the handoff's Blockers section instead. If this reproduces in
production (same Next.js version, same `src/` layout), the admin console
and every tenant page are currently unreachable via their intended
subdomain. This needs someone with authority over deploy/routing to
confirm and fix (likely a one-line move: `git mv middleware.ts
src/middleware.ts`, or `src/proxy.ts` per the new convention) — flagging as
urgent given the blast radius.
