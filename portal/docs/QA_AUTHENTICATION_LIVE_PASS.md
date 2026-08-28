# Live Authentication QA Pass (Session 23)

Adversarial, live end-to-end testing of every authentication path built in
Sessions 18–20, run over real HTTP against real production
(`keen-prod` — no staging exists for the portal, see `docs/ENVIRONMENT.md`),
using the seven real QA accounts + QA organization from Session 22
(`docs/QA_LIVE_TEST_ACCOUNTS.md`). No unrelated demo/sample accounts were
invented; one disposable registration-test account was created to exercise
the registration/email-change paths and was suspended again before this
session ended (see "Test account created and cleaned up" below).

This was a black-box pass: no direct database access was available or used
(`PORTAL_DATABASE_URL_PROD` is CI-only, gated by the `production` GitHub
Environment). Every check below is inferred from real HTTP responses
(status codes, redirect targets, session-cookie behavior) and real email
read back from Gmail — the same vantage point a real attacker or a real
user has, not an internal view of the database.

## Bugs found

### 1. [Fixed] `signOut()` never revoked the session server-side — stolen/copied cookie kept working after "logout"

**Severity: High.** Auth.js's `signOut()` (used by every portal's nav "Log
out" button and by `cancelLoginMfaAction`) only cleared the client-side
cookie. The underlying `Session` row was never revoked, so it stayed valid
— fully re-authenticated — until its natural 30-day expiry. A session
cookie captured before logout (XSS, a shared/public machine, a proxy log,
a browser-extension leak, etc.) kept granting full access indefinitely
after the legitimate user believed they had logged out.

**Live repro** (before the fix): logged in as the QA TROUBLESHOOTER
account, confirmed `GET /security` → `200`. Saved the raw
`__Secure-authjs.session-token` cookie value. Performed a real sign-out
(`POST /auth/signout` with a fresh CSRF token) — got the expected `302`
with `Set-Cookie: ...session-token=; Max-Age=0`. Then replayed the **old**
cookie value (captured before sign-out) directly against `GET /security`
in a fresh request with no other cookies — got `200` with the full
authenticated page content ("Change password", "Security" sections
rendered), not a redirect to `/login`.

This is distinct from the **explicit** "Revoke"/"Sign out everywhere"
actions on `/security` (`src/lib/sessions.ts`'s `revokeSession`/
`revokeAllUserSessions`), which were separately live-verified below and
correctly reject the identical cookie on the very next request — those
were never broken. Only the plain `signOut()` path (the actual "Log out"
button everyone uses) had no revocation wired to it at all.

**Fix**: `src/lib/auth.ts` now registers `events.signOut`, which extracts
`sessionId`/`sub` from the JWT and calls a new, narrow
`revokeSessionAsSystem(sessionId, userId)` (`src/lib/sessions.ts`) —
revokes exactly that one session (never every session for the user, so
logging out of one device doesn't silently sign a user out everywhere
else). Two new regression tests in `src/lib/sessions.test.ts`. Full suite
re-run after the fix: **537/537 passing** (535 baseline + 2 new), `tsc
--noEmit` clean, `npm run build` clean.

**Not yet deployed** — this fix exists only in this session's working tree
(uncommitted, same as several prior sessions leave for the next
merge/deploy decision). See "Deploy status" below.

### 2. [Fixed] A revoked session was mislabeled "Suspended" instead of "Revoked" on the Security page

**Severity: Low (cosmetic, but security-adjacent — a user auditing their
own active sessions saw an incorrect status).** `src/components/security/
SecurityPanel.tsx`'s "Devices & sessions" table rendered a session with
`revokedAt` set as `<StatusBadge status="suspended" />` ("Suspended"),
even though `src/components/ui/Badge.tsx` already defines a correct
`revoked` status/label (added by Session 14 for `Certificate.status`) that
was simply never used here. Found while inspecting the real rendered
`/security` page during the session-revocation test above.

**Fix**: one-line change to `status="revoked"`. Visual styling is
unchanged (both share the same red/danger tone class); only the label text
changed from "Suspended" to "Revoked".

### 3. [Documented, not fixed] Auth.js's raw REST endpoints resolve the wrong host when hit directly

**Severity: Low — confirmed does NOT affect the real product UI.** Calling
Auth.js's generic `/auth/signin/google` and `/auth/callback/credentials`
endpoints **directly** (not through this app's own Server-Action-driven
login pages) produces a redirect target / OAuth `redirect_uri` of
`https://0.0.0.0:3000/...` — the pod's internal bind address — instead of
the real subdomain. If anything ever hits these raw endpoints directly
(a bookmark, a monitoring probe, a future client-side `signIn()` call),
Google would reject that `redirect_uri` outright (`redirect_uri_mismatch`)
and a plain credentials POST would try to send a browser to an
unreachable address.

**Confirmed this is scoped to the raw endpoints only, not a regression of
Session 22's fix**: driving the *actual* login page's real Server Actions
(the literal "Continue with Google" button and the literal login form,
via their real `$ACTION_ID_...` submissions) on `admin.keenafrica.com`
produced the fully correct `redirect_uri=https://admin.keenafrica.com/
auth/callback/google` and `location: https://admin.keenafrica.com/
dashboard` respectively. Real users are unaffected today. Flagged for
whoever owns `src/lib/auth.ts`'s `trustHost` config to understand why host
resolution differs between the two invocation paths — not fixed here
(would need deeper Auth.js-internals investigation than this QA session's
scope, and there is no live product impact to justify the risk of
changing auth host-resolution config without that understanding).

### 4. [Known limitation, re-confirmed live] Email change takes effect immediately with no ownership verification

**Severity: Medium, standalone; was part of a High-severity chain before
fix #1.** Already documented as a known limitation in `src/lib/users.ts`'s
own comment on `changeOwnEmail()` ("No confirmation-email verification
step... flagged as a known limitation, not silently assumed away") — not
a new discovery, but live-reconfirmed as part of this session's mandate to
verify "email change flow if built, including that it doesn't take effect
without verification":

Registered a disposable test account, stepped up (password), called
`changeEmailAction` with an address never proven to be owned by the
account — the account's login email changed **immediately**. Logging in
with the new (never-verified) email succeeded right away; the old email
immediately stopped working.

**Why this matters more than the existing note suggests**: before fix #1
above, this combined into a full account-takeover chain — a stolen/copied
session cookie that survived "logout" (bug #1) could be used to call
`changeEmailAction` (gated only by step-up, i.e. the *current* password/
TOTP — something an attacker with a live stolen session already has by
definition) to point the account's email at an address the attacker
controls, then trigger a password reset to complete full takeover without
ever knowing the original password. Fix #1 closes the "stolen session
survives logout" half of that chain, but the underlying "email change has
no ownership verification" gap remains and is still exploitable by any
other means of session compromise (XSS, a shared machine, a leaked
cookie via a proxy/log, etc.). Recommend prioritizing a real
confirmation-email step for `changeOwnEmail()` — not built here, that's a
real feature decision (token flow, UI, copy) out of this QA session's
scope, per `CLAUDE_BUILD_RULES.md` §2.

## What was live-verified (real HTTP + real Gmail), no bugs found

- **Registration**: new email → account created, auto-signed-in,
  redirected to `/onboarding`. Duplicate email → `error=email_taken`.
  Invalid email format → `error=invalid_input`.
- **Google OAuth**: redirect construction confirmed correct on all four
  subdomains via the real product UI (see finding #3 above for the
  raw-endpoint caveat). Full consent-screen completion, the
  existing-password-account linking rejection, and the suspended-account
  rejection could not be driven live end-to-end — same limitation Session
  22 already documented (needs a real second Google identity and a real
  browser completing consent, neither available to this agent). The
  linking rule itself (`src/lib/oauth-identity.ts`'s `resolveGoogleSignIn`)
  was read in full and its existing test coverage (part of the 537
  passing) still passes.
- **Password login**: correct password → success. Wrong password and an
  unknown email both → identical generic `CredentialsSignin` error (no
  information leak), confirming Session 16's `authorize()` audit-write fix
  for the unknown-email path still holds structurally after Sessions
  19/20's changes (the audit_events row itself wasn't directly queryable —
  no DB access — but the externally-observable behavior it was built to
  produce is unchanged).
- **Rate limiting**: drove 11 real wrong-password `POST /auth/callback/
  credentials` attempts against one QA account, then a 12th attempt with
  the **correct** password — still rejected, confirming the per-account
  limit (10/15 min, `docs/PRODUCTION_HARDENING.md`) blocks pre-emptively
  exactly as documented, unchanged after Sessions 19/20. Deliberately did
  **not** re-trip the per-IP limit (30/15 min) against real unknown
  emails — every test in this session shared one IP, so doing that would
  have locked this session out of testing every other account for 15
  minutes, for no additional confidence beyond what the per-account test
  above already proved about the shared rate-limit mechanism.
- **Password reset**: real email delivery confirmed directly via Gmail
  (`search_threads` against `from:noreply@keenafrica.com`) for both the
  admin-triggered flow (subject "Reset your Keen Africa admin password")
  and STUDENT's self-service flow (subject "Reset your Keen Africa student
  password", distinct copy: "You requested..." vs "An administrator
  generated..."). Token → new password → immediate re-login confirmed for
  all six non-super-admin QA accounts. A reused token correctly rejected
  (`error=1`, "invalid or expired"). An **expired** token was not
  live-waited (would need a real 60-minute hold) — `resetPassword()`'s
  expired and reused cases share the exact same guard clause and return
  value (`!record || record.usedAt || record.expiresAt.getTime() <=
  Date.now()` → `"invalid_or_expired"`), so the reused-token live proof
  exercises the same code path; confirmed by reading the source, not
  independently live-proven for the time-based branch specifically.
- **Password change while authenticated**: blocked without a fresh
  step-up (redirected to `/step-up`), succeeded immediately after a real
  TOTP step-up, revoked every existing session for the account (old
  password rejected afterward, new password + fresh login succeeded).
- **Session revocation** (the explicit `/security` "Revoke" action,
  distinct from bug #1's plain logout): captured a session cookie, called
  the real `revokeOwnSessionAction`, replayed the identical old cookie —
  correctly rejected (`307` → `/login`) on the very next request. Matches
  Session 02's original live-verified behavior; still holds after Sessions
  19/20.
- **Suspended user cannot authenticate**: suspended a QA account via the
  real admin console, confirmed password login rejected with the same
  generic error as a wrong password (no account-existence leak), and
  confirmed an **already-logged-in** session for that account was killed
  too (both because `suspendUser()` explicitly revokes sessions, and
  independently because `resolveSessionAuthz()` re-checks `user.status`
  on every request). Reinstated the account afterward and confirmed login
  worked again. The Google-OAuth suspended-rejection branch
  (`account_suspended` in `oauth-identity.ts`) was verified by code
  reading only, not a live consent completion (same limitation as above).
- **MFA & step-up — full lifecycle**, driven end-to-end on the QA
  TROUBLESHOOTER account (which had no MFA from Session 22, unlike
  TEACHER/STUDENT — see below): enrolled a real TOTP secret, computed a
  real RFC 6238 code locally, confirmed enrollment, confirmed a fresh
  login now halts at `/mfa` and grants **zero** access to any protected
  page until verified (tried an invalid code first — correctly rejected,
  still blocked), verified with a recovery code, confirmed the **same**
  recovery code is rejected on reuse (single-use enforced) while a
  different unused code from the same batch succeeds, confirmed a
  sensitive action (`changePasswordAction`) is blocked without a fresh
  step-up and redirected to `/step-up`, succeeded immediately after a real
  TOTP step-up, then disabled MFA again (itself step-up-gated) to restore
  TROUBLESHOOTER to its original no-MFA state before finishing.
- **TEACHER/STUDENT's pre-existing MFA** (enrolled in Session 22, no
  TOTP secret or recovery codes available to this agent, and no
  admin-side "reset a user's MFA" feature exists — flagged as a real gap,
  see below): confirmed via the user's approved workaround that a fresh
  password login for both correctly halts at `/mfa` (mfaPending) and that
  every protected route (`/dashboard`, `/courses`, `/security`) correctly
  redirects back to `/mfa` rather than granting any access — the negative
  case is proven live; completing their second factor remains blocked for
  the same reason Session 22 couldn't attempt it for five of seven roles.

## A related gap noticed, not a bug: no admin-side MFA recovery path

There is no way for an admin/troubleshooter to reset or disable another
user's MFA — the only paths (`disableMfa`, `regenerateRecoveryCodes`) are
both self-service and both require the account's own step-up proof. This
is why TEACHER/STUDENT's already-enrolled MFA couldn't be exercised
further in this session (see above) — it's also a real product gap for a
real user who loses their device *and* their recovery codes. Not a
regression, not built here (a genuine account-recovery feature decision,
out of a QA session's scope) — flagged for whoever picks up MFA/account
security next.

## Deploy status

**None of this session's code changes have been deployed.** They exist
only in this session's working tree, uncommitted, same convention several
prior sessions have left for the next explicit merge/deploy decision
(`src/components/security/SecurityPanel.tsx`, `src/lib/auth.ts`,
`src/lib/sessions.ts`, `src/lib/sessions.test.ts`). Production is
currently still running the **pre-fix** code — bug #1 (logout doesn't
revoke) is live in production right now until this is merged and
deployed. Whoever has merge authority should treat that as the priority
item.

## QA account state changes this session

All state changes below were made through the real product surface (no
direct database writes), and are reversible/self-clearing:

- **All six non-super-admin QA accounts' passwords were reset** (via the
  real password-reset flow, tokens confirmed via real email) to
  freshly-generated values as part of this session's testing. New values
  are not written anywhere in this repository, commit, or prompt file —
  they exist only in this agent's local scratchpad (ephemeral, not
  persisted anywhere durable) and were derived independently of, and
  differ from, the token batch the user separately generated and shared
  in conversation. **Recommend rotating `portal-qa-accounts` (the k8s
  credential vault, `keen-prod` namespace) via the normal reset-and-record
  process** so Sessions 24–29 have a durable, correctly-stored record —
  same convention `docs/QA_LIVE_TEST_ACCOUNTS.md` already establishes.
  SUPER_ADMIN was not touched.
- **QA TROUBLESHOOTER**: MFA was enrolled, fully exercised, then disabled
  again — restored to its original no-MFA state. Password was changed
  during the step-up test (see above) — also part of the reset above.
- **QA SPONSOR_USER**: was briefly suspended and reinstated (suspension
  test) — back to Active. Separately, its per-account login rate limit
  was deliberately tripped (11 wrong-password attempts) — it will reject
  even its correct password for up to 15 minutes from that point
  (self-clearing, no action needed).
- **TEACHER, STUDENT, ADMIN, SPONSOR_ADMIN**: no state changes beyond the
  password reset above.
- **Test account created and cleaned up**: `adebiyibanbo+qa.
  session23.newreg.changed@gmail.com` ("QA Session23 NewReg", later
  changed to `...newreg.changed@gmail.com` by the email-change test) —
  created via real self-service registration to exercise
  registration/email-change without touching the canonical seven, then
  **suspended** via the admin console before this session ended (not
  deleted — matches the platform's no-hard-delete convention). Not part
  of the documented QA roster; safe to ignore, or delete outright, in a
  future cleanup pass.

## Tests

- `src/lib/sessions.test.ts`: 2 new cases for `revokeSessionAsSystem`
  (revokes exactly the target session and nothing else; is a no-op for a
  mismatched user id and idempotent on repeat calls).
- Full suite: **537/537 passing** (535 baseline + 2 new). `npx tsc
  --noEmit` clean. `npm run build` clean.
- `RLS_TEST_DATABASE_URL` integration suite not re-run — no schema/RLS
  changes were made this session.

## Blockers

None remaining that stopped verification. Two were raised and resolved
live with the user during this session: the QA account passwords were not
known to this agent (resolved via the real reset-link flow, see above);
TEACHER/STUDENT's pre-existing MFA had no available secret/recovery codes
(resolved via the user-approved workaround — verify the negative case,
run the full MFA lifecycle on TROUBLESHOOTER instead).

## Required next-session actions

- **Whoever has merge authority**: review and merge this session's fix
  for bug #1 (session survives logout) — it is a real, currently-live
  production gap. Deploy promptly; re-verify live post-deploy that a
  captured pre-logout cookie is now rejected (repeat this session's exact
  repro).
- **Whoever owns `src/lib/auth.ts`/Auth.js config**: investigate finding
  #3 (raw REST endpoints resolve `0.0.0.0:3000`) — low urgency (no live
  product impact confirmed), but worth understanding before anything ever
  starts calling those endpoints directly.
- **Whoever picks up MFA/account security next**: consider an admin-side
  MFA recovery path (see "A related gap noticed" above) and a real
  confirmation-email step for `changeOwnEmail()` (finding #4) — both are
  real, scoped feature decisions, not built in this QA session.
- **Sessions 24–29**: this session's QA account passwords are freshly
  reset and known-good as of this session, but only exist in this agent's
  ephemeral scratchpad — **rotate `portal-qa-accounts` properly** (see
  "QA account state changes" above) before relying on them. QA
  SPONSOR_USER may reject even its correct password for up to 15 minutes
  after this session ends (self-clearing).
