# MFA & Account Security (Session 20)

Extends Session 02's Role/Permission/Session model — no second identity,
session, or device model. `src/lib/mfa.ts` is the module other sessions
should extend (new sensitive actions, a richer policy hook) rather than
building a parallel mechanism.

## Identity model additions

- `TotpCredential` (1:1 with `User`) — an encrypted (AES-256-GCM, keyed off
  `AUTH_SECRET`) TOTP secret. `enabledAt` is null between "secret
  generated" and "confirmed with a real code."
- `RecoveryCode` — single-use, SHA-256-hashed-at-rest, same shape as
  `PasswordResetToken`. A fresh batch of 10 is issued whenever TOTP is
  confirmed or regenerated.
- `Session` gained three columns (Session 02's table, not a new one):
  `mfaRequired`, `mfaVerifiedAt`, `stepUpVerifiedAt`.

## Login-time MFA gate

Decided once, at `createSession()` time (`auth.ts`'s `authorize()` and
`oauth-identity.ts`'s `resolveGoogleSignIn()`), via `mfa.ts`'s
`shouldRequireLoginMfa(userId)`: true if the account already has TOTP
enabled, OR its role is covered by the policy hook (`MFA_REQUIRED_ROLES`,
currently `["SUPER_ADMIN"]` — extend this list, or widen
`policyRequiresMfa()`'s inputs for an org-level policy later, rather than
building a second mechanism).

**Enforcement, not suggestion**: `sessions.ts`'s `resolveSessionAuthz()` —
the same per-request function that already makes revocation immediate
(Session 02) — checks `mfaRequired && !mfaVerifiedAt` on every request and,
if true, returns `isSuperAdmin: false, roles: [], permissions: [],
organizationIds: []` regardless of the account's real state. Every
`requirePermission()`/`canAccess*Portal()` check anywhere in the app
therefore already fails closed for a pending session — the `/mfa` page
redirect (each portal's `(protected)/layout.tsx` and `login/page.tsx`) is a
UX convenience on top of that, not the actual boundary.

An account with a role that requires MFA but hasn't enrolled yet is routed
to enroll right there on `/mfa` (not hard-locked out with no path forward);
confirming a fresh enrollment while a login is pending satisfies that
login's MFA requirement in the same step
(`mfa-actions.ts`'s `confirmEnrollmentAction`).

## Recovery / lost device

A recovery code (`mfa-actions.ts`'s `verifyLoginMfaAction`, or `mfa.ts`'s
`completeLoginMfa`) satisfies login MFA exactly like a TOTP code, and is
audited (`mfa.recovery_code_used`) and consumed in the same transaction
that validates it — replay-proof under concurrent use
(`RecoveryCode.updateMany({ where: { usedAt: null }, ... })`, checked via
`result.count`).

Replacing a lost authenticator: `beginTotpEnrollment()` on an
already-enabled credential requires step-up first (a recovery code counts
as a step-up factor), then re-enroll as normal — no separate "recovery
mode."

## Step-up authentication

`mfa.ts`'s `requireStepUp(actor)` / `verifyStepUp(actor, credential)`, keyed
off the SAME session row's `stepUpVerifiedAt` (10-minute freshness window,
`STEP_UP_WINDOW_MS`). `credential` is one of `{type: "password"}`,
`{type: "totp"}`, `{type: "recovery_code"}` — whichever factors the account
actually has (a Google-only account with no password has none; an account
with no MFA enrolled has only the password branch).

**Wired into, this session:**

| Action | Where | Note |
|---|---|---|
| Disable MFA | `mfa.ts`'s `disableMfa()` | Always — never a plain toggle |
| Regenerate recovery codes | `mfa.ts`'s `regenerateRecoveryCodes()` | |
| Replace an enabled TOTP credential | `mfa.ts`'s `beginTotpEnrollment()` | Only when already enabled — first-time enrollment needs none |
| Change own password | `users.ts`'s `changeOwnPassword()` | New self-service action this session added |
| Change own email | `users.ts`'s `changeOwnEmail()` | New self-service action this session added; no confirmation-email step (matches this repo's existing no-email-verification convention) |
| Assign `SUPER_ADMIN` or `ADMIN` role | `users.ts`'s `assignRole()` | Gated on the *role being granted*, not the grantor's own role — `PRIVILEGED_ROLES` |
| Grant `org_admin` on an organization | `organizations.ts`'s `changeMemberRole()` | This platform's closest equivalent to "change organization owner" — see that function's doc comment for why |
| Export a CSV report | 3 admin report routes + 1 sponsor project-report route | GET routes redirect to `/step-up?returnTo=...` instead of returning 403/a form |

**Judgment calls, documented rather than silently assumed:**
- "Change organization owner" has no literal single-owner field on
  `Organization` (see `schema.prisma` / `ORGANIZATION_CORE.md`) —
  `org_admin` membership is the closest concept, so granting it is what's
  gated. Demoting *away* from `org_admin` is not gated (reducing access
  isn't the escalation direction this control exists for).
- "Create/promote a super-admin" has no in-app capability at all today —
  `User.isSuperAdmin` is seed-only (`prisma/seed/tasks/super-admin.ts`).
  Nothing was built to fill that gap (out of this session's boundary per
  CLAUDE_BUILD_RULES.md §2 — it isn't an existing capability to gate,
  it's a new admin feature). **Contract for whoever builds it**: call
  `requireStepUp(actor)` before writing `isSuperAdmin: true`, the same way
  every action in the table above does.

## Device/session list

`/security` (self-service, every portal) lists sessions via Session 02's
existing `listSessions()`/`revokeSession()`/`revokeAllUserSessions()` —
verbatim, no new query/table. Revoking a session takes effect on that
session's very next request, same as it always has.

## Enrollment/verification contract (for QA)

1. `GET /security` (or `/mfa` if a login is pending) → "Set up two-factor
   authentication" → `beginEnrollmentAction` → secret + `otpauth://` URI +
   QR SVG, stashed in a 5-minute httpOnly cookie (never a DB read-back of
   the plaintext secret).
2. Scan/enter the secret in an authenticator app, submit the 6-digit code
   → `confirmEnrollmentAction` → `mfa.ts`'s `confirmTotpEnrollment()`.
   Wrong code: `?error=invalid_code`, nothing enabled. Right code:
   `enabledAt` set, 10 recovery codes generated, shown exactly once via
   another short-lived cookie (`?codes=1`), audited `mfa.enabled`.
3. Every subsequent login for this account now requires a code
   (`completeLoginMfa`) — TOTP: ±1 30-second step tolerance (RFC 6238
   standard). Recovery code: single-use, case/whitespace-insensitive.
4. 8 failed attempts (TOTP or step-up combined) in 15 minutes per account
   blocks further attempts regardless of correctness
   (`rate-limit.ts`'s `isMfaAttemptRateLimited`, reusing the same
   audit-log-counting mechanism Session 16 built for login rate limiting —
   no new table).

## Known limitations

- **A Google-only account with no TOTP enrolled has no step-up factor at
  all.** `verifyStepUp()`'s password branch fails closed (no
  `passwordHash`); there's no "re-run Google OAuth as step-up" path in
  this session's scope. Such an account simply cannot complete any
  step-up-gated action until it enrolls TOTP (which itself needs no
  step-up the first time).
- **No QR code library was avoided for TOTP itself** (hand-rolled RFC
  6238/4226 on Node's `crypto` — see `mfa-crypto.ts`'s header comment for
  why), but `qrcode` (new dependency) renders the enrollment QR SVG —
  display-only, never in the verification path.
- **Org-level MFA policy is a code list, not a UI-configurable table.**
  `MFA_REQUIRED_ROLES` in `mfa.ts` is the whole policy today; widening it
  to organizations is a real schema decision left to whoever needs it
  (Organization has no `requiresMfa` field — deliberately not added
  without Organization Core's own review).
- **Recovery codes/QR secret are shown via short-lived httpOnly cookies**,
  the same "read-once, not stored, not query-param-leaked" pattern
  `triggerPasswordResetAction` already uses for reset links. A page reload
  after the 5-minute TTL loses the reveal (not the underlying
  enrollment/codes — those are already durably in the DB).
- **No admin-facing "require MFA for this specific user" override** —
  policy is role-based only, matching the session brief's own example
  (`SUPER_ADMIN`).

## Tests

- `mfa-crypto.test.ts` — pure TOTP/base32/encryption/recovery-code unit
  tests, no DB.
- `mfa.test.ts` — real-Postgres integration tests: enrollment, disable,
  regenerate, login-gate (`resolveSessionAuthz` zeroing), rate limiting,
  `requireStepUp`/`verifyStepUp` for all three credential types.
- `users.test.ts` — `assignRole` privileged-role step-up gating,
  `changeOwnPassword`/`changeOwnEmail`.
- `organizations.test.ts` — `changeMemberRole` step-up gating for granting
  `org_admin`.
- `rls.integration.test.ts` — new "MFA & Account Security (Session 20)"
  block, run against the real non-superuser `portal_rls_test` role: a
  plain context can't touch `totp_credentials`/`recovery_codes` at all;
  self can read/write only their own rows; `app.mfa_login_lookup`
  authorizes exactly the pre-full-session path `completeLoginMfa()` needs;
  a stranger's context can't touch someone else's `sessions` row's new
  columns.
- **Live-verified against a real running server** (`npm run build` +
  `npm run start`, real Postgres, real HTTP with `Host` headers, same
  method Session 02 established): a real password login for a
  `SUPER_ADMIN`-role test account with no TOTP enrolled → real
  `302 → /mfa` (not the dashboard); real TOTP enrollment + login
  verification (via the same `mfa.ts` functions the real Server Actions
  call) on that exact session → the *same, unchanged* session cookie now
  reaches the dashboard (`200`); the same account hitting a CSV export
  route with its step-up freshness cleared → real `302 → /step-up`; after
  a real `verifyStepUp()` call → the same cookie now downloads the CSV
  (`200`, `text/csv`); revoking that session in the DB → the same cookie
  is rejected on the very next request (`307 → /login`), confirming
  Session 02's revocation behavior is unaffected. All test data (1 user,
  its sessions/roles/audit rows) deleted afterward, confirmed zero rows
  remain; the test server process was stopped and confirmed unreachable.
  **Not exercised via raw HTTP**: the enrollment/step-up Server Actions'
  own multipart encoding (submitted via direct function calls against the
  real session instead, for the reasons above) — covered instead by
  `mfa.test.ts`'s real-Postgres integration tests, which call the exact
  same functions.
