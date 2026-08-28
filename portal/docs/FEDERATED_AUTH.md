# Federated Auth & Transactional Email (Session 19)

Adds Google OAuth as a second Auth.js provider alongside the existing
password (Credentials) provider, and wires a real transactional email
provider behind `src/lib/mailer.ts`'s existing `sendMail()` signature —
resolving the one blocker Session 02 (password reset) and Session 18 (org
invitations) both left open.

## Decision already made (not reopened here)

An Organization/Tenant + auth impact audit compared extending Auth.js with
OAuth providers against migrating to a third-party CIAM (Auth0/Clerk/
WorkOS/Entra External ID). Decision: **extend Auth.js. Do not migrate.**
This repo's session revocation, RLS session-var injection, and
audit-on-every-security-action (`src/lib/sessions.ts`,
`docs/IDENTITY_SECURITY.md`) are custom, Postgres-native, already tested,
and provider-agnostic — `createSession()` doesn't care whether `authorize()`
was satisfied by a password or a Google token. See
`PLATFORM_ARCHITECTURE.md` §16 and `PLATFORM_CONTEXT.md`'s "Organization/
Tenant model" section.

Providers at launch: **Google OAuth and password.** Microsoft and
passwordless email magic-link were considered and explicitly deferred, not
rejected. MFA (Session 20) is a separate, later session.

## Why no database adapter

This repo's Auth.js setup has no adapter — it uses Credentials + a custom
`sessions` table (`src/lib/sessions.ts`), not next-auth's own session/
account model. Confirmed by reading the installed `@auth/core`:
`handleLoginOrRegister()` (`node_modules/@auth/core/lib/actions/callback/
handle-login.js`) short-circuits to `return { user: <raw OAuth profile>,
account }` the moment `adapter` is undefined — meaning **without an
adapter, Auth.js does zero identity linking on its own.** Every "does this
Google account belong to an existing User" decision in this codebase is
hand-rolled in `src/lib/oauth-identity.ts`.

## `UserIdentity` — the linking contract

```prisma
model UserIdentity {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId            String   @map("user_id") @db.Uuid
  provider          String
  providerAccountId String   @map("provider_account_id")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("user_identities")
}
```

Migration: `prisma/migrations/20260828120000_federated_auth_email`. Also in
that migration: `users.password_hash` becomes **nullable** — a Google-only
account has no password at all, never a derived/placeholder one.

Keyed on `(provider, providerAccountId)` — Google's stable `sub`, **never
email**. Email is only ever used as a one-time signal at first sign-in
(does an unlinked account already claim it) and is deliberately never the
join key for returning sign-ins.

RLS (new `app.oauth_lookup` session var, same shape as `app.auth_lookup`/
`app.self_registration`): a plain context can read/write only its own row
(`user_id = app.user_id`); the one pre-auth SELECT/INSERT
`resolveGoogleSignIn()` performs before any session exists is carved out
the same way `app.self_registration` carves out the pre-auth `users`
insert. See the migration's own comments for the full policy text.

## The account-linking rule

Implemented entirely in `src/lib/oauth-identity.ts`'s
`resolveGoogleSignIn()`, called from `src/lib/auth.ts`'s `signIn` callback.
In order:

1. **A `UserIdentity` row already exists** for this `(google,
   providerAccountId)` → sign in as that linked `User`. Always (unless
   suspended).
2. **No identity row, but the request carries a valid link-intent
   cookie** (`src/lib/oauth-link-intent.ts`) → this is an
   already-authenticated user's self-service "Connect Google" (see below)
   → link this Google account to their own `User` and sign them in.
3. **No identity row, no link-intent cookie, but a `User` already exists
   with this email** (a password account that has never connected
   Google) → **REJECT.** `email_exists_unlinked`. This is the case this
   session's "Must NOT: silently merge two accounts on email match without
   a deliberate, documented rule" forbids. The login page tells the user to
   sign in with their password and connect Google from their profile
   (case 2) instead.
4. **No identity row, no link-intent cookie, no existing `User` with this
   email, and the sign-in happened on a subdomain that allows self-service
   signup** (teacher/student — see below) → brand-new Google-only account,
   same shape as Session 18's self-registration (`passwordHash: null`,
   exactly one role).
5. **Anything else** (no signup role — admin/sponsor subdomains, which have
   no public signup path at all per Session 18's "Must NOT") → **REJECT.**
   `no_self_service_signup`.

Why this is safe and not a silent merge: case 2 (the only path that links
an *existing* password account to a Google identity) only ever fires when
the linking cookie is present, and that cookie can only be minted by
`{student,teacher,sponsor}/(protected)/profile`'s `connectGoogleAction`,
which requires a real, already-authenticated `session.user.id` — so linking
requires proving control of the password account (being logged in) *and*
proving control of the Google account (completing its OAuth handshake) in
the same request chain. Neither alone is sufficient.

### Which subdomain may create a new account

Mirrors Session 18's `REGISTERABLE_ROLES` restriction exactly:
`teacher.<root>` → `TEACHER`, `student.<root>` → `STUDENT`, everything else
(`admin.<root>`, `sponsor.<root>`) → no signup role, so a first-time Google
sign-in there is always rejected rather than silently creating an ADMIN/
SPONSOR_* account. Resolved via the real `Host` header
(`next/headers`'s `headers()`, called from `src/lib/auth.ts`'s
`subdomainSignupRole()`), not anything client-supplied.

### Rejection reasons and where the user lands

| reason | shown on | message |
|---|---|---|
| `no_email` | `/login` | Google account has no email |
| `email_exists_unlinked` | `/login` | sign in with password, then connect Google |
| `no_self_service_signup` | `/login` | no account linked (admin/sponsor) |
| `conflicting_link` | `/profile` (not `/login` — see below) | Google account already linked elsewhere |
| `account_suspended` | `/login` | account suspended |

`conflicting_link` is special-cased to redirect to `/profile` instead of
`/login`: it can only happen mid self-service linking, and an
already-authenticated actor would otherwise bounce straight off `/login`
(via its own `canAccess*Portal` redirect) before ever seeing the message.

## Self-service "Connect Google"

`{student,teacher,sponsor}/(protected)/profile` — a "Connected accounts"
card. `connectGoogleAction` mints a short-lived (5 min), single-use,
HMAC-signed (via `AUTH_SECRET`), HttpOnly cookie
(`src/lib/oauth-link-intent.ts`) identifying the calling
`session.user.id`, then calls `signIn("google", { redirectTo:
"/profile?linked=1" })`. The cookie — not a bare user id — matters because
an HttpOnly cookie only stops client-side *reads*; signing it stops a
malicious page from setting one directly to fake "link this Google account
to victim's id." `listOwnLinkedProviders()` backs the page's "Google —
connected" vs. "Connect Google" state. No admin profile page exists today
(pre-existing gap, not introduced here) — admins have no self-service
linking UI, only the reject-on-no-existing-link path applies to them.

## No special-casing for session/revocation/audit

`resolveGoogleSignIn()` calls the exact same `createSession()`/
`recordAuditEvent()` (`login.succeeded`/`login.failed`, plus a new
`oauth_identity.linked` action) every other provider uses — the `Session`
row carries no `provider` column, deliberately: a Google-originated
session is revoked via `revokeSession()`/`revokeAllUserSessions()` and
re-validated via `resolveSessionAuthz()` identically to a password one, per
this session's explicit acceptance criterion. Provenance (which provider
authenticated a given login) lives only in the audit event's `metadata`,
not in the canonical session model.

## Mutating `user.id`/`user.sessionId` in the `signIn` callback

Without an adapter there is no other hook to rewrite Google's `sub` into
our internal `User.id` before the `jwt` callback runs. Confirmed by reading
`node_modules/@auth/core/lib/actions/callback/index.js`: the `user` object
passed to the `signIn` callback (`params.user`) is the *same object
reference* later passed to `callbacks.jwt({ user, ... })` when no adapter
is configured — so `user.id = result.userId` there is what makes
`token.sub` end up correct. This is documented in `src/lib/auth.ts`'s
comment rather than left as an unexplained-looking mutation.

## Google OAuth provider config

`src/lib/auth.ts` — `Google({ clientId: GOOGLE_CLIENT_ID, clientSecret:
GOOGLE_CLIENT_SECRET })`, additive to the existing `Credentials` provider.
Callback URL to register in Google Cloud Console per environment:
`https://<subdomain>.<root-domain>/auth/callback/google` — confirmed live
against a real running server that Auth.js correctly builds this
per-request (via `x-forwarded-host`/`Host`), not a single fixed URL, when
invoked through `src/lib/auth.ts`'s exported `signIn()` (the path every
login/connect button in this app actually uses).

## Transactional email — Resend

`src/lib/mailer.ts`'s `sendMail()` now POSTs to Resend's REST API
(`https://api.resend.com/emails`) via a plain `fetch()` call — no SDK
dependency added for one HTTP call. New env vars (see
`docs/ENVIRONMENT.md`): `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`. Both unset
(or `NODE_ENV !== "production"`) keeps the original dev-console-log stub;
production requires both and throws immediately if either is missing,
exactly like the previous always-throws-in-production stub did. Every
existing caller (password reset, Session 18's org invitations) needed zero
call-site changes.

## Known limitations

- **No real Google OAuth round trip was executed in this sandbox** — no
  real Google OAuth client/test account/browser was available here. What
  *was* verified end-to-end over real HTTP against a running production
  build: (a) the Google provider is live at `/auth/providers`; (b)
  triggering sign-in from each portal's real login page (a real Next.js
  Server Action, not a hand-simulated request) produces the correct
  `https://accounts.google.com/o/oauth2/v2/auth` redirect with the
  configured `client_id`, a PKCE challenge, and — critically — the
  *correct subdomain-specific* `redirect_uri`; (c) password login,
  end-to-end, unaffected. The account-linking rule itself (new account,
  returning account, existing-password-email rejection, self-service
  linking, conflicting link, suspended account, session-revocation parity)
  is proven by `src/lib/oauth-identity.test.ts` against the real local
  Postgres — not a mocked DB, only `next/headers`'s `cookies()` is shimmed
  (unavoidable outside a real request context) — but the actual
  `/auth/callback/google` leg (exchanging a real Google authorization code)
  was not exercised, since that requires Google's own servers to
  participate.
- **No "unlink Google" self-service action.** `user_identities` has no
  DELETE RLS policy — a linked identity is permanent today. Flagged rather
  than half-built; a future session can add
  `user_identities_delete: user_id = app.user_id` (trivial) plus a button.
- **No rate limiting on `/auth/signin/google` or the profile "Connect
  Google" action** — Session 16's rate limiting covers password `/login`
  specifically; same category of gap Session 18 already flagged for
  `/register`.
- **No admin/sponsor "Connect Google" UI** — those portals have no
  self-profile page at all today (pre-existing, not introduced here), so
  only an already-linked Google account can sign in there; a first-time
  Google sign-in is always rejected (`no_self_service_signup`), matching
  Session 18's "no public path to an ADMIN/SPONSOR_* account."
