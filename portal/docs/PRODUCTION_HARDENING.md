# Production hardening (Session 16)

This session reviewed the platform end-to-end against the checklist in
`sessions/16-production-hardening.md` and closed the gaps that were within
the portal's own boundary. It did not rebuild anything Sessions 01–15
already got right — most of the checklist (backups, RLS, session
revocation, audit logging, secrets-out-of-source-control, environment
separation) was already in place and is verified-not-rebuilt below.

## Security checklist — status

| Item | Status |
|---|---|
| Passwords hashed | Already done (Session 02, bcrypt cost 12) — unchanged. |
| Secrets externalized | Already done (Session 01/02, `docs/ENVIRONMENT.md`) — unchanged. |
| Encryption at rest | Not configured (ZFS pool, no encryption) — pre-existing, documented limitation in `docs/BACKUP_RESTORE.md`/`docs/ENVIRONMENT.md`; an infra/cost decision outside this session's authority, not newly discovered. |
| TLS/secure transport | Verified live: Cloudflare Universal SSL + `always_use_https = "on"` (`../terraform/main.tf`), proxied through Cloudflare Tunnel (`portal.tf`'s wildcard CNAME). Confirmed live against production (`curl -D- https://admin.keenafrica.com/auth/csrf`) that session/CSRF cookies carry `__Host-`/`__Secure-` prefixes with `Secure; HttpOnly; SameSite=Lax` — Auth.js's `trustHost` + forwarded-header detection is working correctly end-to-end, not just configured. |
| Server-side authorization | Already done (Sessions 02–14, `requirePermission`/`requireOwnResourceOrPermission` on every mutation) — unchanged, not re-audited line-by-line this session (out of scope: that's each owning session's job, per `CLAUDE_BUILD_RULES.md` §1/§5). |
| RLS/ownership boundaries | Already done; this session added one narrow additive policy (see Migrations below) and re-ran the full RLS integration suite plus a fresh backup/restore drill to confirm nothing regressed. |
| Audit logging | Already done; this session added two new audit actions (`login.failed`, `login.rate_limited`) to close a real gap — see Rate limiting below. |
| Session revocation | Already done and re-verified live this session (see TLS row above) — unchanged. |
| **Rate limiting** | **New this session** — see below. Was entirely absent before. |
| Secure uploads | Already done (Session 13, `docs/ASSETS.md`) — unchanged. |
| No sensitive logs | Reviewed: `src/lib/mailer.ts`'s `sendMail()` (which would otherwise console-log a password-reset token) already throws in production instead of logging — confirmed by reading the source, not just trusting the docstring. No sensitive-value logging found elsewhere (`console.error` call sites all log an error object/generic message, never a credential/token). |
| No demo accounts in production | Verified in code, not just docs: `prisma/seed/guard.ts`'s `assertDemoSeedAllowed()` unconditionally throws when `NODE_ENV === "production"`, before it even checks `ALLOW_DEMO_SEED` — this can't be bypassed by setting the opt-in flag in prod. |
| **Security headers** | **New this session** (app-level; see below) — Cloudflare-level headers are defined in `../terraform/main.tf` but were found **absent** on a live production response — see Known gaps. |

## Rate limiting (new)

`src/lib/rate-limit.ts`. Login brute-force protection on `/auth/callback/credentials`
(the credentials `authorize()` callback in `src/lib/auth.ts`) — there was no
rate limiting anywhere in the platform before this session.

- **Per-account**: 10 failed attempts / 15 minutes, keyed by the resolved
  user's id (`login.failed` + `login.denied_suspended` audit events).
- **Per-IP**: 30 failed attempts / 15 minutes, keyed by `X-Forwarded-For`.
  Covers email-enumeration/spraying attempts against unknown emails, which
  have no account to key the per-account limit on.
  **Post-deploy E2E fix**: the first version of this shipped a real bug
  here — `authorize()`'s `if (!user) return null` path recorded no audit
  event at all for an unknown email, so the per-IP limit could never
  actually accumulate against exactly the attack it's documented to cover.
  Caught during this session's post-deploy live E2E pass (the earlier live
  verification only drove wrong-password attempts against a *real* known
  user, never an unknown one) — a real end-to-end HTTP run against a
  locally built server, not just a unit test, since the unit tests wrote
  audit rows directly and never exercised `authorize()` itself. Fixed:
  `!user` now records `login.failed` with `actorId: null`, mirroring what
  `src/lib/audit.ts`'s own `AuditEventInput` docstring already anticipated
  ("actorId is nullable — some security events have no authenticated
  actor (e.g. a failed login attempt against an unknown email)"). Re-
  verified live: 31 real attempts against a nonexistent email correctly
  produced 30 `login.failed` + 1 `login.rate_limited`, then cleaned up
  from the local dev DB.
- Checked **before** the bcrypt password compare, so a blocked attempt
  doesn't pay that cost, and a blocked attempt fails identically to a wrong
  password (no information leak about which limit tripped, or that a limit
  exists at all).
- Backed by the existing `audit_events` table — no new table. Works
  correctly across both replicas in `k8s/portal-prod.yaml` (unlike an
  in-memory counter, which wouldn't be shared pod-to-pod).
- New audit actions: `login.failed` (wrong password — did not exist before;
  failed logins were previously invisible in the audit log entirely),
  `login.rate_limited` (blocked before the password was even checked).
- **Verified live**, not just unit-tested: created a throwaway user, drove
  11 real `POST /auth/callback/credentials` requests against a locally
  built production server, and confirmed via direct DB query that attempts
  1–10 recorded `login.failed` and attempt 11 recorded `login.rate_limited`
  — i.e. the 11th attempt was blocked exactly at the documented threshold.
  Fixture cleaned up afterward (session/audit rows + the user deleted).

**Not built**: rate limiting on `requestPasswordReset()`. Both of its
current callers (`src/app/student/(protected)/profile/actions.ts`,
`src/app/admin/(protected)/users/[id]/actions.ts`) are already-authenticated
actors resetting their own or a permission-gated target's password — there
is no public, unauthenticated "forgot password" entry point yet (see
`docs/IDENTITY_SECURITY.md`'s Known limitations), so there's no anonymous
abuse surface to rate-limit today. **If a public forgot-password page is
ever added, it must call `isLoginRateLimited`-style protection (or extend
`src/lib/rate-limit.ts`) before it ships** — flagged for whoever builds
that page.

## Security headers (new, app-level)

`next.config.js`'s `headers()` — `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: geolocation=(), microphone=(), camera=()`,
`Strict-Transport-Security` (production only), and a portal-scoped
`Content-Security-Policy-Report-Only` (self-hosted fonts/scripts/styles
only — no external CDNs, unlike the static site's policy). Verified live
locally: built and ran the production server, confirmed every header is
present on both `/healthz` and a real page response.

**Report-Only, not enforcing** — same reasoning as the Cloudflare-level
policy below: there's no violation-report collection endpoint wired up in
this repo, and flipping to enforcing without first checking real traffic
risks breaking the app for all four portals at once. Promoting it is a
follow-up, not done here.

## Known gap: Cloudflare-level security headers not observed live

`../terraform/main.tf` defines `cloudflare_zone_settings_override` (HSTS +
`X-Content-Type-Options`) and a `cloudflare_ruleset` "Security response
headers" (`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Content-Security-Policy-Report-Only`) as **zone-wide** rules, which should
cover every `*.keenafrica.com` host including the portal.

**Live check found them absent**: `curl -D- https://admin.keenafrica.com/login`
returned no `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Strict-Transport-Security`, or CSP header at all — only Cloudflare's own
`nel`/`report-to`/`cf-ray` headers were present.

This is **not fixed by this session** — `terraform/main.tf` configures the
shared Cloudflare zone the static site (`~/keenafrica/site*`) also depends
on, which is outside the portal's boundary (`CLAUDE_BUILD_RULES.md` §2:
report a missing dependency, don't redesign another module). The app-level
headers added above mean the portal is protected regardless, but the
underlying drift (terraform defines it, production doesn't serve it —
possibly never applied, possibly a ruleset-ordering/precedence issue) needs
whoever owns that shared terraform/Cloudflare config to investigate
`terraform plan` for drift against the real zone.

## Observability: health checks (new)

`k8s/portal-prod.yaml` had **no liveness or readiness probes at all**
before this session — a wedged or still-starting pod was invisible to
Kubernetes (no readiness gate meant traffic kept routing to a pod that
wasn't ready; no liveness gate meant a hung pod was never restarted).

- `src/app/healthz/route.ts` — new, unauthenticated `GET /healthz`. Runs a
  real `SELECT 1` against the database (not just "the process is up") and
  returns `200 {"ok":true}` or `503 {"ok":false}`.
- Deliberately outside `src/middleware.ts`'s tenant-rewrite matcher (same
  exclusion treatment as `/auth`) — kubelet's probe request has no
  `*.keenafrica.com` Host header to resolve a tenant from, and would
  otherwise 404 before reaching the route.
- `k8s/portal-prod.yaml`: added `startupProbe` (generous — 30 × 2s — so a
  normal cold start isn't mistaken for a hang), `readinessProbe`, and
  `livenessProbe`, all against `/healthz`.
- **Verified live locally**: built and ran the production server, `curl
  /healthz` returned `200 {"ok":true}` with a real DB connection; killing
  the process made subsequent requests fail to connect (`000`), confirming
  the probe would correctly report the pod as down in that state.

**Not built**: no external uptime monitor / alerting integration (e.g.
PagerDuty, Uptime Robot) — none exists anywhere in this infra today for
any service, portal included; that's a new integration decision (which
provider, who gets paged) outside this session's authority. `/healthz`
existing is the prerequisite for wiring one up later — flagged, not built.
The daily `backup-portal-db.yml` workflow already IS a functioning alert
today in the sense the session brief cares about: **a failed
restore-verification fails the GitHub Actions run**, which GitHub notifies
the repo's watchers about — pre-existing (Session 01), re-verified working
this session (see Backup/restore below), not new.

## Dependency/security review

`npm audit` found 3 high-severity CVEs, all transitive (via `next`):
PostCSS (XSS via unescaped `</style>` in stringified output; arbitrary
`.map`-file disclosure via attacker-controlled `sourceMappingURL`) and
`sharp`'s bundled `libvips` (multiple CVEs). Fixed by bumping `next` from
`16.2.11` to `16.3.3` — a **patch** release within the existing
`^16.2.11` range in `package.json` (no major-version risk). `npm audit`
now reports 0 vulnerabilities. Verified afterward: `tsc --noEmit`,
full test suite (393/393), and `npm run build` all still pass — see
Tests below.

Run `npm audit` periodically (or wire it into CI — not done here, since
adding a new required CI gate that could start failing builds on drive-by
transitive advisories is a call for whoever owns `deploy-portal.yml`'s
gating philosophy, not assumed here).

## Migration deployment process & rollback plan

**Process** (unchanged, reviewed not rebuilt): `deploy-portal.yml` runs
`prisma migrate deploy` against `PORTAL_DATABASE_URL_PROD` (the
`kf_portal_prod_migrator` role) **before** swapping the running image —
so for the brief rollout window, the *previous* code version runs against
the *new* schema. This is why every migration in this repo to date is
purely additive in the sense that matters for the rollout window (new
tables/columns/policies, never a rename or drop — still true as of
2026-09-06). **That is not the same as being rollback-safe**: two
migrations tighten a *new* column to `NOT NULL` in the same commit as the
code that fills it, which is fine going forward and breaks going backward.
See "Rollback compatibility floor" below. It also means those two
migrations make writes to the affected table fail for the length of the
rollout window itself (the old image is still serving, against a schema
that already enforces the constraint) — seconds to a minute, on a
pre-launch system with no traffic, but the same shape is worth an
expand/contract split once there is real traffic to lose.

Keep the additive discipline; a breaking (renaming/dropping) migration
needs an expand/contract split across two deploys, not a single-step
migration alongside a code swap.

**Rollback — new this session**:
- `deploy-portal.yml` now also annotates the deployment with
  `kubernetes.io/change-cause=<image>` after each successful rollout, so
  `kubectl rollout history -n keen-prod deployment/portal` is
  self-documenting (previously every revision showed a blank
  change-cause — confirmed live before this change).
- `.github/workflows/rollback-portal.yml` — new, manual `workflow_dispatch`
  (`image_tag` input = the git SHA to roll back to), gated by the same
  `production` GitHub Environment manual-approval every other
  production-affecting workflow here uses. Re-points the deployment at an
  already-built GHCR image; deliberately does **not** touch the database.
- **Rollback only rolls back code, never schema.** Prisma's `migrate
  deploy` has no automatic "down" migration. Rolling back to an older image
  is safe exactly when every migration between the rollback target and the
  current `main` was additive **and** the older image can still satisfy
  every constraint the schema now enforces. That second condition is not
  automatic, and it is no longer met for every image in this repo's
  history — **see "Rollback compatibility floor" immediately below, which
  supersedes this section's original "true of every migration to date"
  claim.** Rolling back past a genuinely breaking migration needs a
  hand-written reverse migration first, evaluated on its own merits at
  that time.

### Rollback compatibility floor

> Corrected by **Session 49 (2026-09-06)**. This section, and
> `rollback-portal.yml`'s header, both used to state that rollback was safe
> "all the way back" because every migration in this repo was additive.
> That stopped being true in Session 31 and went stale silently for six
> sessions — `docs/GO_LIVE_READINESS.md` §11.4 has the full finding.

**Current safe rollback floor: `9871a03` (Session 36).**

`rollback-portal.yml` enforces this: it refuses a target below the floor
unless the dispatcher explicitly ticks `acknowledge_below_floor`.

Two migrations add a column, backfill it, then `SET NOT NULL`. The code
that populates each column ships in the *same commit* as its migration, and
`rollback-portal.yml` correctly does not touch the database — so an image
from before that commit keeps writing `NULL` into a column the schema still
forbids, and the write fails immediately:

| Floor-setting commit | Session | Migration | What breaks below it |
|---|---|---|---|
| `9871a03` | 36 | `20260901130000_keen_africans_article_author_name` — `articles.author_name` `SET NOT NULL`, satisfied by `resolveAuthorName()` in `src/lib/articles.ts` | **Every article creation fails.** Keen Africans publishing is dead. |
| `6b1c2b3` | 31 | `20260831100000_attempts_course_id_denormalization` — `attempts.course_id` `SET NOT NULL`, satisfied by `src/lib/attempts.ts` | **Every new assessment attempt fails** on a NOT NULL violation. |

The floor is the **later** of these, `9871a03`. No data is at risk in either
case — both columns are derived and reconstructible — but an operator who
rolls back below the floor during an incident gets a deployment that looks
healthy and silently cannot accept core writes, which is worse than not
rolling back.

**This floor is maintained, not discovered.** Any migration that adds a
`NOT NULL` column, a new `CHECK`, a new unique index, or any other
constraint that code older than the migration cannot satisfy **must raise
the floor in the same PR**, in both places:

1. `ROLLBACK_FLOOR_SHA` / `ROLLBACK_FLOOR_DESC` in
   `.github/workflows/rollback-portal.yml`
2. this table

To re-derive the list from scratch (this is exactly how Session 49
confirmed it, and it is cheap enough to re-run any time the floor is
doubted):

```bash
grep -rlE "SET NOT NULL|DROP COLUMN|DROP TABLE|RENAME (COLUMN|TO)" prisma/migrations/
```

Every hit is a candidate; check whether the code that satisfies the new
constraint shipped with it, and if so its commit is a floor candidate. As
of 2026-09-06 that command returns exactly the two migrations above, and no
migration in this repo has ever dropped or renamed anything.
- **Not executed live against production** — dispatching it would
  redeploy real production traffic, which this session treated as a
  "confirm with the user first" action rather than something to do
  unilaterally while verifying documentation. Mechanically confirmed
  instead, read-only: `kubectl rollout history -n keen-prod deployment/portal`
  shows 11 retained revisions (14–24) and `kubectl set image`/`kubectl
  rollout status` are the exact primitives the new workflow wraps — the
  same commands `deploy-portal.yml` already runs successfully on every
  push. Recommend running `rollback-portal.yml` once against the
  *current* image tag as a safe, no-op validation (it just redeploys the
  identical image) before relying on it during a real incident.

## Backup/restore — re-verified, not rebuilt

Session 01 already built and documented this fully (`docs/BACKUP_RESTORE.md`):
daily automated backup + same-workflow restore-verification
(`backup-portal-db.yml`), a fully self-contained restore drill
(`scripts/backup/test-restore-drill.sh`), and a written incident runbook.

**Re-run this session** (required after this session's schema change —
see Migrations below): `./scripts/backup/test-restore-drill.sh` against
fresh disposable containers — passed. Marker row and **145 RLS policies**
(up from whatever count existed when `docs/BACKUP_RESTORE.md` was written —
that doc's restore-runbook step 5 said "should be 20 as of this migration
set," which was already stale before this session from 14 sessions' worth
of accumulated policies; corrected in that doc to reference "the current
`SELECT count(*) FROM pg_policies` output" instead of a specific number
that will keep drifting) survived the dump/restore round trip on a clean
database, including the new `audit_events_rate_limit_lookup_select` policy
this session added.

## Privacy / data-retention review

Reviewed against `PLATFORM_CONTEXT.md`'s security rule and
`CLAUDE_BUILD_RULES.md` §4/§6 — no code changes; this is a review of
what's already there.

- **What's collected**: `User` (name/email/optional phone), enrollment/
  progress/attempt/answer data, `StudentNote`/`Bookmark` (student-owned,
  RLS-scoped to the owner — see `docs/STUDENT_WORKSPACE.md`), messages
  (Session 09), certificates (Session 14), sponsor-visible beneficiary
  links (Session 11).
- **Who can see it**: enforced at two layers per `docs/IDENTITY_SECURITY.md`
  — application-layer `requirePermission`/ownership checks (primary) plus
  Postgres RLS (coarse backstop). Sponsor visibility is explicitly
  privacy-scoped (Session 11: a sponsor sees only their own
  projects/beneficiaries — re-confirmed live in Session 15's demo-data
  handoff, not re-tested here).
- **Retention/deletion**: no destructive deletes anywhere reviewed — the
  platform consistently uses status/lifecycle fields (`User.status`,
  `Enrollment.status`, content's DRAFT→PUBLISHED→ARCHIVED, certificate
  `revoked`) rather than removing rows. `audit_events` has no
  UPDATE/DELETE RLS policy at all — permanently append-only, by design.
- **Gap, not fixed here**: there is no user-initiated account
  deletion/anonymization flow (e.g. a GDPR-style "erase my data" request)
  anywhere in the platform. Building one is a real, scoped feature
  decision (what "anonymized" means for a student with certificates/
  attempts/audit history tied to their id) — explicitly a **new product
  feature**, which this session's brief says not to introduce. Flagged for
  a future session, not attempted here.
- **Messaging privacy**: `assertCanMessage`'s relationship check (Session
  09) already restricts who can start a conversation with whom; not
  re-audited line-by-line this session (Session 09 owns it).

## Performance / load review

No dedicated staging environment exists to load-test against (see
`docs/ENVIRONMENT.md` — deliberately retired before this repo's Phase 1
cutover), and standing one up is an infra-cost decision outside this
session's authority, same as it was for Session 01. This is a **review**,
not a load-testing exercise.

- **Compute**: 2 replicas, `100m`/`500m` CPU and `128Mi`/`512Mi` memory
  (request/limit) per pod (`k8s/portal-prod.yaml`, unchanged). Reasonable
  for current traffic; no evidence reviewed suggesting it's under- or
  over-provisioned (no metrics history was available to check against).
- **Database**: every `auth()` call does 1–3 queries
  (`docs/IDENTITY_SECURITY.md`'s documented tradeoff, accepted then,
  re-confirmed still true and still the right call at current scale —
  not changed here). `src/lib/db.ts` uses the standard Next.js
  dev-mode Prisma singleton; no explicit connection-pool size override
  exists anywhere, so Prisma's default (`num_cpus * 2 + 1` per pod) applies
  — worth an explicit `connection_limit` on `DATABASE_URL` if pod count or
  Postgres `max_connections` ever becomes a constraint, not needed yet at
  2 replicas.
- **In-process event bus**: `src/lib/events.ts` is in-process/synchronous
  (Session 01's documented tradeoff, re-affirmed by Session 02 — "revisit
  if/when request volume makes it a real bottleneck"). Still true; not
  revisited here.
- **New load this session adds**: `isLoginRateLimited()` adds up to 2 extra
  DB round trips per login attempt (was already doing 1+ for the user
  lookup). Negligible at current login volume; would be the first thing to
  reconsider (e.g. combine into one query, or add a covering index on
  `(action, actor_id, created_at)`/`(action, ip_address, created_at)`) if
  login volume ever grows enough for it to matter — not needed at
  current/anticipated scale.

## Environment isolation — one real gap closed

Confirmed production cannot run demo-seed tasks even if `ALLOW_DEMO_SEED=true`
is mistakenly set there — `prisma/seed/guard.ts`'s `assertDemoSeedAllowed()`
checks `NODE_ENV === "production"` first and throws unconditionally.

**Closed a gap flagged (not fixed) by Session 15's live-production-
verification handoff entry**: the guard used to check only `NODE_ENV`/
`ALLOW_DEMO_SEED`, never `DATABASE_URL` itself — a developer with
legitimate access to `PORTAL_DATABASE_URL_PROD` who ran `ALLOW_DEMO_SEED=
true npm run demo:reset` locally with `NODE_ENV` unset (as most local
shells are) was not blocked. Only the complete absence of any automated
path that does this actually prevented it in practice. Fixed:
`assertDemoSeedAllowed()` now also refuses when `DATABASE_URL` matches the
`kf_portal_prod_*` role-naming convention (`README.md`/
`docs/BACKUP_RESTORE.md` — both production Postgres roles share `_prod_`;
no documented non-production role does). Purely additive — every
previously-refused case is still refused; this only adds a new refusal
path. Two new test cases in `prisma/seed/guard.test.ts`.

No staging environment exists (a prior, deliberate infra decision — see
`docs/ENVIRONMENT.md`); re-affirmed as out of this session's authority to
change, same as Session 01 found.

## Secret rotation procedure

No rotation had ever been documented step-by-step before (`docs/ENVIRONMENT.md`
said *where* secrets live, not *how* to rotate each one). New:

| Secret | Where | How to rotate |
|---|---|---|
| `AUTH_SECRET` | k8s `Secret` `portal-secrets` (`keen-prod`) | Generate a new value (`openssl rand -base64 32`), update the k8s Secret, roll the deployment (`kubectl rollout restart -n keen-prod deployment/portal`). **Invalidates every existing session immediately** (Auth.js re-signs/re-verifies JWTs with it) — plan for a mass forced re-login, don't do this casually mid-day without warning. |
| `DATABASE_URL` (app role `kf_portal_prod_app`) | k8s `Secret` `portal-secrets` | Rotate the Postgres role's password on `postgres01`, update the k8s Secret, roll the deployment. Role itself is unchanged (RLS-scoped, no `BYPASSRLS`) — only the credential. |
| `PORTAL_DATABASE_URL_PROD` (migrator role `kf_portal_prod_migrator`) | GitHub Actions secret, `production` environment | Rotate the Postgres role's password, update the GitHub environment secret. Used by `deploy-portal.yml`, `backup-portal-db.yml`, and now `rollback-portal.yml` doesn't need it (rollback is code-only) — but the other two do; the next scheduled backup or deploy run is the natural verification that the new credential works. |
| `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` | GitHub Actions secret, `production` environment | Not a live-rotation case — `prisma/seed/tasks/super-admin.ts` never overwrites an existing account's password (see `docs/IDENTITY_SECURITY.md`). To rotate the actual super-admin's live password, use the normal admin password-reset flow (`requestPasswordReset`/`resetPassword`), not this secret — this secret only matters for bootstrapping a *new* environment's first super-admin. |
| `GITHUB_TOKEN` (GHCR login) | GitHub-managed, per-workflow-run | Nothing to rotate — GitHub mints and expires this automatically every run. |

General rule for any of the above: rotating a k8s-Secret-backed value always
ends in `kubectl rollout restart -n keen-prod deployment/portal` — updating
the Secret object alone doesn't change what a *running* pod already has in
its environment.

## Disaster recovery runbook

Restore procedure is unchanged and already fully documented —
`docs/BACKUP_RESTORE.md`'s "Restore runbook (real incident)" section. This
session's contribution is the fresh restore-drill verification above (with
this session's own new migration included) and the rollback-plan section
above for the "app is broken, DB is fine, just need last week's code back"
case that's distinct from "the database itself is gone."

## Database migrations

One new migration: `20260827210000_production_hardening_rate_limit` — adds
a single additive RLS SELECT policy, `audit_events_rate_limit_lookup_select`,
following the exact `app.auth_lookup`/`app.password_reset_lookup`
convention from `identity_security_foundation` (a new boolean session var,
`app.rate_limit_lookup`, set only by `src/lib/rate-limit.ts`). No new
tables/columns. Applied and verified locally (`prisma migrate deploy`,
then the full test suite and the restore drill, both above).

## APIs/contracts

- `src/lib/rate-limit.ts`: `isLoginRateLimited({ userId?, ipAddress? }): Promise<boolean>`.
  Internal to `src/lib/auth.ts` today; exported for testability and for any
  future public auth-adjacent endpoint (e.g. a forgot-password page) to
  reuse rather than reimplement.
- `GET /healthz` (`src/app/healthz/route.ts`) — new, unauthenticated.
  `200 {"ok":true}` / `503 {"ok":false}`. k8s probe target; not intended
  for any other caller, no stability contract beyond the status code.
- `RlsContext.rateLimitLookup` (`src/lib/rls.ts`) — new, internal-only
  option on `withRls()`, same convention/visibility as `authLookup`/
  `passwordResetLookup`.

## Permissions

None added. Rate limiting and the health check are both unauthenticated/
system-level by nature — nothing here is gated by `PERMISSIONS`, and
nothing existing changed.

## Events

None added. `login.failed`/`login.rate_limited` are audit-log actions
(`recordAuditEvent`), not domain events (`src/lib/events.ts`) — consistent
with `login.denied_suspended`, which was already audit-only, not an event,
before this session.

## Tests

- `src/lib/rate-limit.test.ts` — new, 5 cases: allows a clean account,
  blocks an account past its per-account threshold, doesn't cross-block an
  unrelated account, blocks an unknown-email attempt past its per-IP
  threshold, and confirms a fresh IP isn't blocked just because the
  account is (near-)blocked.
- Full existing suite re-verified after every change in this session:
  **393/393 passing** (388 baseline + 5 new), zero regressions.
  `npx tsc --noEmit` clean. `npm run build` succeeds, including the new
  `/healthz` route appearing in the route manifest.
- Live verification (not just unit tests) for: rate limiting (11 real HTTP
  login attempts, see above), security headers (`curl` against a real
  built server), `/healthz` (real 200 with DB up, real connection failure
  after killing the process), TLS/cookie security (`curl` against actual
  production), and the backup/restore drill.

## Known limitations

- Cloudflare-level security headers are defined in terraform but not
  observed live — see "Known gap" above. Portal is still protected via the
  new app-level headers; the terraform/Cloudflare drift itself needs the
  shared-zone owner.
- CSP stays Report-Only (both at Cloudflare and now at the app level) —
  promoting to enforcing needs real violation data first, which needs a
  report-collection endpoint that doesn't exist yet.
- No account-deletion/anonymization flow (privacy review, above) — a real
  feature decision, out of this session's "no new product features" scope.
- No external uptime/alerting integration — `/healthz` is the prerequisite,
  not the integration itself.
- Rate-limit thresholds (10/account, 30/IP per 15 min) are a reasonable
  starting point, not tuned against real traffic (none of the kind this is
  meant to catch has been observed in production yet, by design).
- The rollback workflow was built and mechanically reasoned through but not
  dispatched against production in this session — see the Rollback section
  above for the recommended safe first real test.

## Blockers

None — everything in this session's Owns list was either already
satisfied (verified, not rebuilt) or addressed within the portal's
boundary. The one cross-project item (Cloudflare/terraform header drift)
is flagged above as a dependency on the shared zone's owner, not a
blocker to this session's own completion.
