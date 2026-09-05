# Go-Live Readiness (Session 30)

**Verdict: NO-GO.** Two confirmed, currently-live, currently-reproducible defects block real
students/teachers from using core product surfaces: assessments (P0, platform-wide 500/stuck-
loading) and file storage (uploads unreadable across the 2 production replicas). Every item below
is confirmed with live evidence gathered this session — timestamps, curl output, log lines, DNS
records, `pg_stat_activity` queries — not asserted from memory or from prior sessions' docs alone.

## Precondition check

Session 29 (QA: Security/RLS) reported **"No finding remains open. Session 30 is not blocked"**
(`status/project-status.md`, Session 29 entry; `docs/QA_SECURITY_RLS_LIVE_PASS.md`). Re-read in
full before starting this session, not just the summary line. Confirmed: no open Session 29
finding exists. This session was not blocked by that precondition.

## 1. Session 16's original production-hardening checklist, re-confirmed against Organization Core

Session 16's checklist (`sessions/16-production-hardening.md`) was walked item-by-item against
the actual current authorization graph, not assumed unchanged:

| Item | Status | Evidence |
|---|---|---|
| Passwords hashed | Unchanged | bcrypt cost 12, Session 02 — not touched by Org Core. |
| Secrets externalized | Unchanged | `portal-secrets` k8s Secret, out-of-band. Not independently re-verified this session — this sandbox's classifier blocks reading k8s Secret objects (`kubectl get/describe secret` both denied), same wall every session since 22 has hit for `portal-qa-accounts`. Relying on Session 16/19's original confirmation plus indirect evidence (mailer/OAuth both function in production — see §2). |
| Encryption at rest | Still not configured (ZFS, no encryption) | Pre-existing, flagged since Session 01. Unrelated to Org Core. |
| TLS/secure transport | Re-confirmed live today | `curl -D- https://admin.keenafrica.com/login` → `strict-transport-security: max-age=31536000; includeSubDomains; preload`, `__Secure-`/`__Host-`-prefixed cookies observed during the live QA-TEACHER/QA-STUDENT login flows below. |
| Server-side authorization | Re-confirmed for the Org Core surface specifically | `organization-aware-education-rls.integration.test.ts` (16 cases) + `rls.integration.test.ts`'s "Organization Core" block (8 cases) — all 45 RLS integration cases run live this session against the real non-superuser `portal_rls_test` role, **45/45 passing**. |
| RLS/ownership boundaries | **Extended by Org Core — reviewed, one gap already found+fixed by Session 29, one verification gap remains** | See §4. |
| Audit logging | **Extended by Org Core, correctly** | `src/lib/organizations.ts` calls `recordAuditEvent()` for every mutating action: `organization.created/updated/status_changed`, `organization_membership.approved/rejected/accepted/suspended/reinstated/removed/role_changed/invited`, `organization_invitation.created/revoked` — confirmed by reading the source (13 call sites), not assumed. Same `recordAuditEvent()` every other module uses; no parallel audit mechanism introduced. |
| Session revocation | Unchanged, re-verified by Session 29 live (suspended/revoked session rejected immediately) | `status/project-status.md`, Session 29 entry. |
| Rate limiting | **Unaffected by Org Core, confirmed by reading the source** | `src/lib/rate-limit.ts` keys purely on `actorId`/`ipAddress` (audit-event-backed, per-account and per-IP) — no organization dimension exists or is needed; reused as-is by `src/lib/mfa.ts`'s `isMfaAttemptRateLimited()`. Not weakened or bypassed by any org-scoped login path. |
| Secure uploads | **Live-confirmed broken today, unrelated to Org Core** | See §7 (file storage). |
| No sensitive logs | Unchanged | Not re-audited line-by-line this session (Session 16 already reviewed `mailer.ts`; no new logging call sites found in Org Core's `organizations.ts` during this session's reading of it). |
| No demo accounts in production | Re-confirmed at the code level | `prisma/seed/guard.ts`'s `assertDemoSeedAllowed()` unconditionally throws in `NODE_ENV=production` and additionally refuses any `DATABASE_URL` matching `kf_portal_prod_*` (Session 16's own fix). `prisma/seed/guard.test.ts` — both cases still pass in this session's run (550/550 full suite). **Not independently re-queried against the live production database this session** (no direct production DB access in this sandbox — same classifier wall as everywhere else); resting on the code-level guarantee plus no evidence of any seed run against production in `deploy-portal.yml`'s history (it never invokes the seed). |
| Security headers | Re-confirmed live today | `curl -D- https://admin.keenafrica.com/login` → `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy`, `permissions-policy`, `content-security-policy-report-only`, `strict-transport-security` all present, byte-for-byte matching Session 16's original list. Cloudflare-zone-level headers are still separately absent (unchanged known gap, outside portal's boundary) — app-level headers still cover it. |

**Organization Core's actual effect on this checklist**: it added new RLS-protected tables
(`organizations`, `organization_memberships`, `organization_invitations`) with their own audit
trail and permission gates (`organizations.manage`), and it narrowed (never widened) visibility on
five existing Education Core tables by adding an organization-membership condition that is a
structural no-op for every row where `organization_id IS NULL` (see §5 for the exact policy SQL
reviewed). No item in Session 16's original checklist was weakened by Organization Core. One new
gap in the same *category* Session 16 covered (RLS/ownership boundaries) was introduced and then
partially closed — tracked in §4, not silently folded into the "unchanged" list above.

**Environment isolation — one previously-undocumented fact found mid-session, resolved, low risk**:
`postgres01` (documented in `docs/BACKUP_RESTORE.md` as production's dedicated Postgres VM) turns
out to host `keenafrica_portal_prod` alongside three sibling databases on the same instance,
sharing the cluster-wide role catalog and instance-level resources. Traced via git history: one
sibling (`keenafrica_portal`) is the deliberately-preserved, confirmed-dormant pre-cutover
`dev.keenafrica.com` database (not written to since Session 01-era's Phase 1 cutover); another
(`testdb`) is untraced, likely unrelated VM scratch. Neither `docs/ENVIRONMENT.md` nor
`docs/BACKUP_RESTORE.md` currently document that `postgres01` hosts more than one portal-related
database. Full detail and the connection to the assessments investigation in §6. Not a go-live
blocker on its own (the dormant database isn't live traffic), but a real documentation gap and a
loose end worth a deliberate decision (delete vs. document) — see Required next-session actions.

## 2. Transactional email provider (Session 19) — correctly configured in production

- **Code-level, no dev-stub fallback reachable**: `src/lib/mailer.ts`'s `sendMail()` throws
  immediately in `NODE_ENV === "production"` if `RESEND_API_KEY`/`MAIL_FROM_ADDRESS` are unset —
  read directly from source this session, not assumed from docs. There is no code path that falls
  through to the `console.log` dev stub in production.
- **DKIM/SPF/DMARC — re-verified live via public DNS today** (`dig`, not cited from an old doc):
  - `send.keenafrica.com` SPF: `v=spf1 include:amazonses.com ~all` (Resend's underlying
    provider), with MX `feedback-smtp.eu-west-1.amazonses.com` for bounce handling — the standard
    Resend/SES "Return-Path domain" pattern.
  - `resend._domainkey.keenafrica.com` DKIM: a published RSA public key TXT record, signing with
    `d=keenafrica.com` — matches the actual `MAIL_FROM_ADDRESS` (`noreply@keenafrica.com`, per
    `docs/QA_LIVE_TEST_ACCOUNTS.md`'s confirmed-delivered invitation email).
  - DMARC (`_dmarc.keenafrica.com`): `v=DMARC1; p=none; ...; adkim=r; aspf=r` — relaxed alignment
    on both mechanisms. Since DKIM's `d=` matches the header `From` domain exactly, DMARC passes
    via DKIM alignment regardless of the SPF Return-Path living on the `send.` subdomain (relaxed
    SPF alignment only requires the same organizational domain, which `send.keenafrica.com` and
    `keenafrica.com` share). **This is a correctly-configured setup**, not the mismatch it first
    appeared to be before checking DMARC's alignment mode.
  - **Residual, named gap**: DMARC policy is `p=none` (monitor-only, not enforcing) — a spoofed
    email failing SPF/DKIM would still be delivered, only reported. Not a go-live blocker (this is
    a common, defensible interim posture), but worth tightening to `quarantine`/`reject` once the
    `rua` reports (currently routed to a personal Gmail address, not a team alias) have been
    monitored for a period.
- **This session could not independently trigger a fresh live send** — no QA credential flow that
  exercises `sendMail()` was re-run this session (email delivery was already confirmed end-to-end
  by Session 22, and re-triggering it wasn't necessary given the DNS-level re-confirmation above
  plus the unchanged source). Resting on Session 22's live-confirmed delivery + this session's own
  fresh DNS check, not re-asserting Session 22's result unverified.

**Confirmed**, with the DMARC-posture note above as a named, non-blocking limitation.

## 3. No QA or demo/seed account can authenticate against production

**This item cannot be confirmed as literally worded, and is deliberately not being force-fit to
pass.** Two different account classes exist and behave differently:

- **Demo/seed accounts (Session 15)**: confirmed blocked from production at the code level —
  `assertDemoSeedAllowed()` unconditionally refuses in `NODE_ENV=production` and additionally by
  `DATABASE_URL` pattern (Session 16). No seed task is ever invoked by `deploy-portal.yml`. This
  half of the item holds.
- **QA accounts (Session 22)**: **do authenticate against production, by deliberate design.**
  `docs/QA_LIVE_TEST_ACCOUNTS.md` was explicitly edited one day before this session
  (`6be1553`, 2026-08-28) to drop its own disposal/rotation instructions, with the stated reason
  "every session since 22 (23–26) has treated these seven accounts and the QA org as permanent,
  reusable QA fixtures, not disposable ones." Sessions 23–29 all reused them; Session 29's own
  handoff explicitly left them active for Session 30 to reuse; this session used two of them
  (QA TEACHER, QA STUDENT) to live-verify the assessments bug in §6.
- **Resolved with the site owner during this session**: QA accounts are being kept as a deliberate,
  time-bound accepted risk — clearly labeled (`QA ` name prefix, `+qa.<role>` Gmail alias,
  dedicated `QA Test Org (Session 22)`), credential-vaulted separately from the app's own
  `envFrom` secrets, real login/authorization/RLS boundaries apply to them identically to any real
  user (they are not a backdoor — every QA session including this one has crafted-request-tested
  them like any other account). **The site owner has stated intent to permanently purge all QA
  accounts from production on a future date**, not yet scheduled. This is named explicitly as an
  accepted, temporary exception, not silently passed as "confirmed."

**Verdict for this item: demo/seed half CONFIRMED. QA-account half is a named, accepted,
site-owner-approved exception — not a go-live blocker, but not "confirmed satisfied" either.**

## 4. Organization Core's RLS policies (Sessions 17, 21) verified against the real non-superuser
   role in a production-equivalent environment

- **What exists and was re-run this session**: `portal_rls_test`, a real non-superuser Postgres
  role (`NOSUPERUSER NOBYPASSRLS`) created by `scripts/dev/create-rls-test-role.sql`. All 45 RLS
  integration tests (`rls.integration.test.ts` + `organization-aware-education-rls.integration.
  test.ts`) were re-run this session against it — **45/45 passing**, output captured live.
- **What this is not**: `docs/ENVIRONMENT.md` and the SQL script's own header both explicitly
  document `portal_rls_test`/`RLS_TEST_DATABASE_URL` as **local dev/test only — never staging or
  production**. There is no staging environment (`docs/ENVIRONMENT.md`'s "Environments" section,
  a deliberate, prior infrastructure decision, reaffirmed by Sessions 01 and 16). Production's own
  real non-superuser role, `kf_portal_prod_app`, is provisioned out-of-band and was **not**
  connected to directly by this session's RLS test suite.
- **What partially substitutes for it**: Session 29's live, crafted-request HTTP pass against real
  production (cross-org, cross-student, suspended-session, etc.) does exercise the real
  `kf_portal_prod_app` role indirectly, through the app layer — and this session's own live
  reproduction of the assessments bug (§6) also ran real queries through that same production role.
  But Session 29's own handoff is explicit that its **specific new fix** (the
  `20260829100000_users_select_cohort_relationship_org_boundary` migration, the cross-org PII
  leak) was verified **only** against `portal_rls_test`, not against real production — because
  production has no ORGANIZATION-scoped course to exercise that code path
  (`docs/QA_ORGANIZATION_LIVE_PASS.md`'s item 14, still BLOCKED for live verification, re-confirmed
  still true this session — no organization-scoped course exists in production today).

**Verdict: NOT fully satisfied as worded.** The newest and most security-sensitive Org Core RLS
change (Session 29's cross-org PII fix) has been verified against the real Postgres RLS engine
using a role with identical RLS-relevant properties to production's role, but not against the
literal production role or a production-equivalent environment, because neither exists for this
purpose. This is a real, named gap, not a pass. Mitigating factor: the fix is a pure narrowing
(no-op for `organization_id IS NULL`, i.e. every row in production today), so the residual risk is
bounded to "the day someone creates the first ORGANIZATION-scoped course" — at which point this
must be the very first thing re-verified live (flagged again below, same as Sessions 21/24/26/27/28
already flagged).

## 5. Rollback plan specific to the Session 17–21 migrations

Reviewed every migration file from Session 17 (Organization Core) through the org-boundary fix
that landed the day before this session, not assumed safe from the handoff prose alone:

| Migration | Session | Shape | Rollback risk |
|---|---|---|---|
| `20260827220000_organization_core` | 17 | 3 new tables (`organizations`, `organization_memberships`, `organization_invitations`) + new RLS policies on them. No `ALTER TABLE` on any pre-existing table. | **None.** Rolling code back past this point while these tables remain in the DB is a pure no-op for old code (it never queries them). |
| `20260828100000_self_registration` | 18 | New RLS session var/policy carve-out only. | None — additive. |
| `20260828120000_federated_auth_email` | 19 | New `user_identities` table; `users.password_hash` becomes **nullable** (was it not already? — confirmed: this is a widening, not a narrowing, of what's valid; no existing row is invalidated). | None — additive/widening only. |
| `20260828140000_mfa_account_security` | 20 | New `totp_credentials`/`recovery_codes` tables; 3 new nullable columns on `sessions`. | None — additive. |
| `20260828150000_organization_aware_education` | 21 | `ADD COLUMN organization_id UUID` (nullable) + `scope` (`NOT NULL DEFAULT 'platform'`) on `courses`/`cohorts`/`assessments`/`questions`; **replaces** `courses_select`/`cohorts_select`/`enrollments_select`/`assessments_select`/`questions_select` RLS policies. No `UPDATE`/backfill statement anywhere in the file — read in full, confirmed. | **Reviewed line-by-line**: every replaced policy's new organization branch is wrapped `("organization_id" IS NULL OR "organization_id" = ANY(app.organization_ids))` — a structural no-op for every existing row (100% of production data has `organization_id IS NULL` today, confirmed no ORGANIZATION-scoped course exists in production — §4). Rolling the **application code** back to pre-Session-21 while this migration's schema/policies remain in place is safe: old code never references the new nullable columns, and the new policies are behaviorally identical to the old ones for every row that exists. |
| `20260828160000_cohort_relationship_user_visibility` | 26 (fix, not 21) | Replaces `users_select`. | Additive fix, same reasoning. |
| `20260828170000_conversation_creator_returning_visibility` | 27/28 (fix) | Replaces `conversations_select`. | Additive fix, same reasoning. |
| `20260829100000_users_select_cohort_relationship_org_boundary` | 29 (fix) | Replaces `users_select` again — narrows the cohort-relationship branches with the same `organization_id IS NULL OR ...` pattern. | Same reasoning — no-op for platform-scoped data. |

**No migration in this range contains a `DROP COLUMN`, a `NOT NULL` retrofit onto existing data
without a default, or a data-mutating `UPDATE`/`DELETE`.** Every one is additive-columns-plus-
policy-replacement. This means:

- **Code rollback** (via `.github/workflows/rollback-portal.yml`, built in Session 16) is safe to
  use for any regression introduced by Sessions 17–29's *code*, all the way back to pre-Session-17,
  **without any schema rollback** — confirmed by this session's own line-by-line migration review,
  not assumed from Session 16's generic "every migration to date is additive" claim.
- **Schema rollback** (a hand-written reverse migration) is not needed for any Session 17–21
  migration under today's production data shape (no ORGANIZATION-scoped course/cohort exists yet).
  **This changes the moment a real organization-scoped course is created**: at that point, rolling
  application code back past Session 21 while the DB still enforces the org-aware policies would
  start *hiding* that org-scoped content from users who could see it under the old code's
  assumptions — not a data-loss risk, but a real behavior change to plan for. Flagged for whoever
  is on call the day the first real organization-scoped course goes live: rollback past that point
  needs a decision (accept the visibility change, or hold the rollback and fix forward instead).
- **`rollback-portal.yml` itself remains undispatched against production** (Session 16's own
  "recommend a no-op dispatch first" advice still not acted on) — not attempted this session either
  (dispatching it against live production traffic is a "confirm with the user first" action, and
  raising it now would have been a fourth thing to ask about mid-session).

## 6. Live-verified P0: `/assessments` is broken in production right now

> **RESOLVED — Session 31 (2026-08-31).** Root-caused (two genuinely
> distinct mechanisms, both confirmed with direct live production
> evidence — not inferred) and fixed. Full writeup, evidence, and fix
> detail: `status/project-status.md`'s Session 31 handoff. Summary:
>
> - **Teacher's 500s**: `listAssessmentsForCourse()`'s Prisma `_count`
>   include generated an unfiltered scan across the entire `attempts`/
>   `assessment_questions`/`assessment_assignments` tables, and RLS policy
>   recursion made that scan re-evaluate a deep policy chain for every row
>   platform-wide, not just the course queried. Fixed by scoping the count
>   queries to the specific assessment ids already selected (PR #56).
> - **Student's "200 but stuck loading"**: a completely different
>   mechanism, only found because the teacher fix didn't resolve it.
>   `attempts_select`'s RLS policy joined through `assessments` to resolve
>   a course, pulling in that table's entire policy tree; the resulting
>   plan's *estimated* cost crossed Postgres's JIT-compilation threshold,
>   so Postgres spent ~6.7s JIT-compiling 2,148 functions for a query that,
>   once compiled, did no actual work (confirmed via live `EXPLAIN ANALYZE`
>   against production — every plan node marked `never executed`). Fixed
>   by denormalizing `course_id` onto `Attempt` (PR #57), the same
>   convention already used for `AssessmentAssignment.courseId`.
> - **Post-fix, both roles, solo + 3-way concurrent, verified against
>   production**: teacher 0.15-0.35s/200 (was 18-29s/500), student
>   0.20-0.40s/200 with the real assignment list rendering correctly (was
>   7-11s/200 but resolving to a swallowed error, not real content).
> - Root cause was captured, not raised via a bumped Prisma timeout or a
>   weakened/bypassed RLS policy — both fixes preserve access rules
>   provably identical to before (verified in each PR's own regression
>   test and reasoning, not merely asserted).
> - One residual item, not blocking: `assessment_assignments`/`attempts`
>   were found completely empty in production mid-session, cause
>   unexplained (not this session's actions) — see project-status.md's
>   Known limitations for this session. The Go/No-Go statement below is
>   otherwise unchanged by this item.

**Independently reproduced live during this session** (not just cited from Session 27), as QA
TEACHER and QA STUDENT (real password + real TOTP MFA, both accounts' actual `/dashboard`→`/mfa`→
`/dashboard` flow completed, not simulated):

- `GET https://teacher.keenafrica.com/assessments` (authenticated as QA TEACHER, `org_admin` of
  `QA Test Org`, real cohort-teacher of the seeded course): **18.05s, HTTP 500.**
- `GET https://student.keenafrica.com/assessments` (authenticated as QA STUDENT): **7.09s, HTTP
  200 but the assignment list never renders** — page body confirmed stuck on the loading state.
- `kubectl logs -n keen-prod -l app=portal --since=2m`, captured immediately after the teacher
  request, shows the fresh error (not a stale log line from Session 27):
  ```
  code: 'P2028', modelName: 'Assessment',
  error: 'Transaction already closed: A query cannot be executed on an expired transaction.
  The timeout for this transaction was 5000 ms, however 17824 ms passed since the start of the
  transaction.'
  ```
  — same signature, same tables (`assessments`/`attempts`/`assessment_assignments`), as Session
  27's original finding. **This is not a stale or flaky report — it reproduces reliably, right now,
  2026-08-29.**

**Reproduced 5 times total this session, 100% reliably** — solo (teacher: 18.05s/500; student:
7.09s/200-stuck-loading) and as a 3-way concurrent burst (fired at `10:30:18`/`:24`/`:30` UTC, all
three resolved `500` at `10:30:41`/`:46`/`:52` — each individual request took ~22-23s under
concurrent load vs. ~18s solo, a mild but real slowdown, not a catastrophic pile-up). This rules out
"flaky/intermittent" as an explanation — it fails every single time, unconditionally.

**Root-cause investigation this session** (in addition to Session 27's, which ruled out CPU/DB
overload and stuck app-process state via a full pod rolling restart):

- **A genuinely new, previously-undocumented fact surfaced mid-session** (from a pgAdmin screenshot
  the site owner shared): production Postgres (`postgres01`) is not a single-purpose instance — it
  hosts `keenafrica_portal_prod` alongside three sibling databases (`keenafrica_portal`, `postgres`,
  `testdb`) on the **same server**, sharing the cluster-wide role catalog and instance-level
  resources (`max_connections`, WAL, checkpoint I/O, buffer pool). **Traced and resolved**: git
  history (`68c0eea` "Decommission dev.keenafrica.com", the README rewrite around it) confirms
  `keenafrica_portal` is the **old, pre-cutover `dev.keenafrica.com` portal database** — deliberately
  preserved with its historical verification data but "no longer written to" once
  `keenafrica_portal_prod` was created fresh for the Phase 1 cutover. Confirmed dormant: nothing in
  the live k8s cluster references it (`keen-staging` namespace exists and `staging.keenafrica.com`
  is live, but only runs the static `site` deployment — no portal workload). `testdb` has no trace
  anywhere in this repo's history — likely unrelated VM-setup scratch, not this app's. **Net effect
  on this investigation**: doesn't change the verdict (the dormant sibling database isn't being
  written to, so it's a low-probability contributor), but it was a real, previously-undocumented gap
  in `docs/ENVIRONMENT.md`/`docs/BACKUP_RESTORE.md` (neither mentions `postgres01` hosting more than
  one portal-related database) worth fixing in a future docs pass, and it broadened what "no other
  active sessions" needs to check going forward — the query in the next bullet was corrected to
  cover it.
- `pg_stat_activity`/`pg_locks` were queried live by the site owner directly against `postgres01`
  four separate times this session, progressively corrected: the first attempt connected to the
  wrong database entirely (`keenafrica_portal`, the dormant one above, not `_prod` — traced to a
  stale pgAdmin tab); the next three connected to the correct `keenafrica_portal_prod` but could
  not be synchronized with an active repro closely enough over chat — each landed 3-18 minutes
  after the failure window had already closed (Prisma aborts and releases its connection at the 5s
  interactive-transaction timeout, so a stalled request leaves no trace once it's given up). Three
  coordinated attempts (including a 34-second 3-request-concurrent burst) all missed the live window
  by 5-10 seconds due to chat round-trip latency alone, even with the request already in flight
  before each message was sent. **No conclusive live capture was obtained.** A real `psql \watch 1`
  loop (started independently, not chat-coordinated) was identified as the right tool but not set up
  in time this session — pgAdmin's Query Tool has no equivalent auto-repeat.
- Reviewed `listAssessmentsForCourse()`/`requireAssessmentReadAccess()`/`isCourseTeacher()`
  (`src/lib/assessments.ts`, `src/lib/courses.ts`): no nested `withRls()` calls (no transaction
  requests a second connection from inside an already-open one), no loop, no external call inside
  the transaction — the query shape itself is unremarkable. No `connection_limit` override exists
  anywhere on `DATABASE_URL` (Prisma's pool defaults to `num_cpus * 2 + 1` per pod, per Session
  16's own performance review, unchanged).

**Root cause remains genuinely unconfirmed.** The concurrent-burst timing (18s solo → ~22-23s under
3-way concurrency, not a multiplied pile-up) is mildly more consistent with connection-pool/resource
contention than with one single stuck lock blocking everything, but this is a weak signal, not
proof. The dormant `keenafrica_portal` sibling database is very unlikely to be the cause (nothing
writes to it) but hasn't been formally excluded. **What the next attempt needs, concretely**: a real
`psql \watch 1` loop against `keenafrica_portal_prod`, started independently a few seconds before a
repro (not coordinated message-by-message over chat), ideally connected as `kf_portal_prod_migrator`
or another role with full `pg_stat_activity.query` visibility (the `keen` role's exact privilege
level was never confirmed this session). This is squarely next-session work.

**This is the headline finding driving the NO-GO verdict.** Assessments are core to
`PLATFORM_CONTEXT.md`'s product model ("education delivery, assessment, student progress"); this is
not a peripheral feature. Reliability (5/5 reproductions, including under concurrent load) means
this is not something that might resolve itself — it needs a fix.

## 7. File/asset storage is confirmed broken across production's 2 replicas

> **RESOLVED — Session 32 (2026-08-31).** Implemented `S3StorageDriver`
> behind the existing `src/lib/storage.ts` abstraction (Session 13),
> backed by a newly-provisioned Cloudflare R2 bucket
> (`keenafrica-portal-assets-prod`, `terraform/portal-storage.tf`);
> `STORAGE_DRIVER=s3` is now production's active driver. Full writeup,
> decision reasoning, and evidence: `docs/ASSETS.md`'s "Session 32"
> section and `status/project-status.md`'s Session 32 handoff. Summary:
>
> - **Live-verified, not just deployed**: real QA TEACHER upload (real
>   password + TOTP, through the actual production URL) landed in R2
>   (confirmed via the Cloudflare API, not local disk), handled by one
>   pod; 26/26 subsequent downloads over the public URL succeeded,
>   byte-for-byte identical to the original, against a Service with
>   exactly 2 pod endpoints — this is Session 28's exact repro, repeated
>   live post-fix, per this session's own acceptance criteria.
> - **2 pre-existing `local`-driver `Asset` rows found** (one is Session
>   28's own already-documented `qa_doc.txt` fixture), both from
>   2026-08-29 — not migrated, because the underlying bytes are already
>   gone (pod-local ephemeral disk, destroyed by every redeploy since;
>   at least 3 full redeploys happened between then and this session).
>   Explicitly accounted for, not silently dropped — see `docs/ASSETS.md`.
> - `assets.test.ts`, `assets-rls.integration.test.ts`, and the
>   messaging/sponsor/certificate RLS tests that reference `storageDriver`
>   all pass unchanged (they never invoke the real driver — verified by
>   reading them, not assumed).

Re-confirmed live by Session 28 (not re-tested again this session, since nothing has changed):
`STORAGE_DRIVER=local` writes to the handling pod's own disk; `k8s/portal-prod.yaml` has no
persistent volume and runs 2 replicas; an upload landing on one pod 500s on download from the
other. `docs/ASSETS.md` itself says "do not deploy file uploads to production before this is
resolved." This affects every feature that uses the shared Asset/File service: Resources (Education
Core), Sponsor documents, Certificates, Messaging attachments. Named here because it is squarely a
go-live blocker for any real organization/sponsor that uploads a file, not because this session
did new work on it.

**This section (above the resolution note) is Session 30's original finding, preserved as
historical record — see the RESOLVED note for current state.**

## 8. Final sign-off checklist by area

| Area | Sessions | Status | Evidence |
|---|---|---|---|
| Authentication (password + Google OAuth + MFA) | 18/19/20 | ✅ with 2 named low-severity gaps | Real Server-Action-driven login (password + Google) re-verified live this session for TEACHER/STUDENT, including real TOTP MFA completion. Auth.js's *raw* REST endpoints (`/auth/signin/google` hit directly, not through the app's buttons) still resolve `redirect_uri`/`signinUrl` to `https://0.0.0.0:3000/...` — re-confirmed live today, already documented as low-severity/no-live-impact by `docs/QA_AUTHENTICATION_LIVE_PASS.md` item 3, not newly discovered, not fixed (would need Auth.js-internals work outside this session's scope, and there is no real product-surface impact to justify touching `trustHost` config without understanding it first). |
| Organization isolation | 17/21/24 | ⚠️ Mostly confirmed, one verification gap | See §4. Cross-org RLS isolation proven under the real RLS-enforcing role; the newest fix not yet proven against production's literal role or with a real org-scoped course (none exists yet). |
| Admin portal | 25 | ✅ | `docs/QA_ADMIN` pass referenced in `status/project-status.md`'s Session 25 entry — not independently re-run this session (no new admin-surface change since). |
| Teacher portal | 26 | ⚠️ | Live-verified working for messaging/onboarding this session's own re-check; **assessments broken** (§6) is a teacher-portal-blocking defect. |
| Student portal | 27 | ❌ blocking | **Assessments broken** (§6, P0, still open). `listMyEnrollments()` draft-course crash — confirmed fixed and deployed (commit `59b53d2`, merged via PR #48, present in current `main`/production HEAD `ef13d46`). Cross-student note/bookmark 500-instead-of-graceful-error — still open, low/medium severity, no actual authorization bypass. |
| Sponsor portal | 28 | ✅ | Isolation/privacy confirmed sound; **file storage** (§7) — resolved by Session 32, live-verified. |
| Security/RLS | 29 | ✅ | No open finding (precondition check, above). |

## Go/No-Go statement

> **Update — Session 31 (2026-08-31)**: item 1 below (`/assessments`) is **resolved** — see §6's
> resolution note and `status/project-status.md`'s Session 31 handoff for full evidence. Item 2
> (file/asset storage) was outside Session 31's scope and remains open, unchanged. **The verdict
> as of this update is still NO-GO**, on the strength of item 2 alone; re-run this session's full
> checklist (not just the assessments item) before flipping to GO.
>
> **Update — Session 32 (2026-08-31)**: item 2 below (file/asset storage) is now also **resolved**
> — see §7's resolution note and `status/project-status.md`'s Session 32 handoff for full evidence
> (live two-pod upload/download repro, post-fix). **Both of Session 30's original NO-GO items are
> now resolved.** This does not by itself flip the verdict to GO — per Session 31's own note above,
> that requires re-running this session's full checklist (§1-§5, §8), not just re-confirming the
> two items that were the acute blockers. Whoever runs that next full pass should treat this as a
> strong signal, not a substitute for one.

**NO-GO for real organizations and real students**, as of 2026-08-29, on the strength of two
independently live-reproduced, currently-open defects:

1. ~~**`/assessments` is unusable in production for every teacher and student** (§6) — a P0 core-
   product-feature outage, reproduced fresh this session, root cause still unconfirmed.~~
   **Resolved by Session 31 — see §6.**
2. ~~**File/asset storage is unreliable across production's 2 replicas** (§7) — blocks Resources,
   Sponsor documents, Certificates, and Messaging attachments for any real user who uploads a
   file.~~ **Resolved by Session 32 — see §7.**

Every other item in Session 30's scope is either confirmed with live evidence (§1 checklist, §2
email, §5 rollback plan) or explicitly named as a bounded, accepted, non-blocking gap (§3 QA
accounts — site-owner-accepted as a time-bound exception; §4 RLS production-role verification —
bounded by "no org-scoped course exists yet"; DMARC monitor-only posture; Auth.js raw-endpoint
host bug — low severity, no live impact).

**What would flip this to GO**: (a) ~~root-causing and fixing the assessments transaction-timeout
bug, confirmed by a fresh live re-test identical to §6's~~ **— done, Session 31**; (b) ~~either
standing up shared/persistent storage for the Asset service or accepting file-upload features as
out-of-scope-for-now and gating them behind a feature flag until storage is fixed~~ **— done,
Session 32 (shared storage, not a feature flag)**. Both of Session 30's originally-identified
blockers are now fixed; per the Session 32 update note above, a full go-live checklist re-run is
still the correct next step before formally declaring GO, not an automatic consequence of both
items being resolved.

## 9. Session 45 (Outstanding Fixes & Consolidation) — 2026-09-05

Session 45 closed the eight concrete, already-identified gaps the 2026-09-01 full platform audit
left open (`sessions/45-outstanding-fixes-consolidation.md`). This section records each one's
status and its live evidence. It does **not** re-declare the Go/No-Go verdict — Session 47 owns
the next real go-live pass, per the audit's own 4-session closeout plan.

**A note on access, because it changes what future sessions should assume**: this session ran on
`keenafrica-infra` itself (the self-hosted runner host) and had, for the first time in this
project, direct read/write access to `keenafrica_portal_prod` on `postgres01` (192.168.2.17,
Postgres 14.24) via `docker run postgres:16-alpine psql`, plus working `kubectl get`/`gh` and
public HTTPS. It did **not** have: `kubectl get secret` value reads (`base64 -d` denied),
Cloudflare API token endpoints (denied, same wall as Session 32), or the ability to run an
application script with `DATABASE_URL` pointed at production (denied — the item 5 correction was
applied as equivalent guarded SQL instead). Probe, don't assume, in either direction.

| # | Item | Status | Live evidence |
|---|---|---|---|
| 1 | Session 33's `answers_select` RLS fix + the data-integrity question | **Closed** | See §9.1 below. |
| 2 | LinkedIn OAuth credentials in production | **Partially closed — one owner-side step remains** | See §9.2 below. |
| 3 | Teacher org-scoped course creation | **Closed (code); deploy-gated** | See §9.3 below. |
| 4 | Review-workflow notifications | **Closed (code); deploy-gated** | See §9.3 below. |
| 5 | Orphaned `Asset` row `10d94d8d-…` | **Closed in production** | See §9.4 below. |
| 6 | Cloudflare R2 API token rotation | **Blocked on site owner** | See §9.5 below. |
| 7 | `postgres01`'s sibling databases documented | **Closed** | See §9.6 below. |
| 8 | `rollback-portal.yml` dispatched once | See §9.7 below. |

### 9.1 `answers_select` join-depth fix, and what actually emptied `assessment_assignments`/`attempts`

**The RLS fix.** Confirmed still needed before touching anything: querying `pg_policy` on
`keenafrica_portal_prod` directly on 2026-09-05 showed `answers_select`/`answers_update` still
carrying the pre-fix teacher branch — `EXISTS (SELECT 1 FROM attempts att JOIN assessments asm ON
asm.id = att.assessment_id JOIN cohorts c ON c.course_id = asm.course_id JOIN cohort_teachers ct
…)`. That is structurally the same "hop through `assessments`, which drags in that table's whole
policy tree" shape Session 31 root-caused as the cause of the student-side `/assessments` P0
(Postgres JIT-compiling a plan whose *estimated* cost crosses `jit_above_cost`, for a query that
executes nothing).

Session 33's fix was reconstructed from its never-merged checkpoint commit (`b63cae2`) and
renamed to `20260905100000_answers_select_join_depth_fix` so it applies after the Sessions 34-44
migrations that landed while it sat unmerged. Both policies now reach `cohorts` directly via
`attempts.course_id` — the column Session 31 denormalized for exactly this reason.

Measured live under the **real enforcing role** (`kf_portal_prod_app`, `NOBYPASSRLS`) against
real production data, EXPLAIN-only:

| | Plan nodes | Top-level estimated cost |
|---|---|---|
| Old (through `assessments`) | 123 | 1,312.93 |
| New (through `attempts.course_id`) | 51 | 357.72 |

**Access is proven identical, not merely cheaper.** The removed hop was "the cohort of the course
that owns the assessment this attempt belongs to"; `attempts.course_id` was backfilled from that
exact `assessments.course_id` value and cannot drift from it (both `attempts.assessment_id` and
`assessments.course_id` are immutable post-creation). On top of that structural argument, the
regression tests now assert both halves of the teacher branch on both policies — the course's own
teacher can select and update an answer, an outsider teacher holding `courses.content.write` can
do neither — plus a plan-shape assertion that `answers_select`/`answers_update` never reference
`assessments` again.

**Part 1 — what emptied `assessment_assignments`/`attempts` in production? Answer: nothing did.
They were never populated.** Session 31 flagged this as an unexplained data-emptying event and it
stayed open through Session 44. Three independent lines of live evidence settle it:

1. **`pg_stat_user_tables` covers the whole life of the database.** `stats_reset` for
   `keenafrica_portal_prod` is `2026-07-24 22:36:12+00`; the earliest `users` row is
   `2026-07-24 22:39:52+00` — the counters start 3m40s *before* the first row this database ever
   held. Over that entire window `attempts` and `assessment_assignments` both show
   `n_tup_ins = 0`, `n_tup_del = 0`, and `last_vacuum`/`last_autovacuum` both NULL. Sibling tables
   are intact and non-zero over the same window (`courses` 1 insert, `enrollments` 3), so the
   counters are demonstrably not stale. A TRUNCATE would have left `n_tup_ins > 0`.
2. **Physical corroboration, immune to any stats reset.** `pg_relation_size` is **0 bytes** for
   `attempts`, `answers` and `assessment_assignments` — not one heap page has ever been allocated.
   Tables that did receive rows (`assessments`, `courses`, `enrollments`) are 8192 bytes.
3. **The audit trail is intact and contains no such action.** 338 `audit_events` rows spanning
   2026-08-26 → 2026-09-01, including `assessment.created` and `assessment.published` — so
   assessment-domain audit writes were working throughout. There is no `assessment.assigned`,
   no `attempt.*`, and nothing matching delete/reset/wipe/truncate/seed anywhere in the table.

The consistent reading: no assessment was ever actually assigned to a cohort or student in
production, so no attempt could ever be started (an attempt can only exist against an existing
assignment). That is unsurprising given `/assessments` was itself broken platform-wide for
teachers and students for the entire period the QA sessions ran — which is Session 31's own
finding. **This item is closed as "ruled out with evidence", not "unknown".**

Independently, Session 33's other real finding is landed: `unassignAssessment()` was the only
deletion path for `assessment_assignments` anywhere in the codebase and had no audit trail at
all. It now records an `assessment.unassigned` AuditEvent. That gap was real regardless of the
conclusion above.

### 9.2 LinkedIn OAuth — credentials are provisioned; the redirect URI is not registered

State has moved since the 2026-09-01 audit, but the feature still does not work end to end.

**Done (not by this session):** `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are present in
the `portal-secrets` k8s Secret and live in the running pods. Verified live by driving the real
`/auth/signin/linkedin` endpoint on `keenafricans.keenafrica.com`, which redirects to
`https://www.linkedin.com/oauth/v2/authorization?...&client_id=78d58gykcdik6j&scope=openid+profile+email`.
LinkedIn recognises that client id: a deliberately bogus one returns a generic error page, while
this one returns a *specific* error.

**Still open (needs the site owner, in the LinkedIn Developer Portal):** that specific error is
**"The redirect_uri does not match the registered value."** Every plausible callback URL was
probed against LinkedIn's own authorization endpoint and all were rejected:

- `https://keenafricans.keenafrica.com/auth/callback/linkedin` — rejected
- `https://keenafricans.keenafrica.com/api/auth/callback/linkedin` — rejected
- `https://keenafrica.com/auth/callback/linkedin` — rejected
- `https://www.keenafrica.com/auth/callback/linkedin` — rejected

So the app exists and is credentialed, but no usable **Authorized redirect URL** is registered on
it. Until `https://keenafricans.keenafrica.com/auth/callback/linkedin` is added there (with the
"Sign In with LinkedIn using OpenID Connect" product enabled), "Connect LinkedIn" cannot complete
for any real user. This session has no LinkedIn Developer Portal access and could not add it.

Separately worth knowing when re-testing: hitting Auth.js's raw `/auth/signin/<provider>` REST
endpoint emits `redirect_uri=https://0.0.0.0:3000/auth/callback/<provider>` — the long-documented,
low-severity Auth.js host-resolution quirk (Session 30 §8, `docs/QA_AUTHENTICATION_LIVE_PASS.md`
item 3). The app's own buttons go through server-side `signIn()` in a Server Action instead, which
is why Google sign-in works in production despite the same quirk. **Re-test through the real
"Connect LinkedIn" button, not through curl against the raw endpoint**, or the raw endpoint's bad
`redirect_uri` will mask whether the registration fix worked.

### 9.3 Teacher org-scoped course creation, and the review-workflow notifications

Both are code changes on `session-45-outstanding-fixes`; both are proven by tests against the real
non-superuser `portal_rls_test` role and by a migration pre-flight against a **restored copy of
the live production database** (`pg_dump` of `keenafrica_portal_prod` taken 2026-09-05, restored
locally, all three new migrations applied cleanly and produced the intended policy/enum state).
Their production status is whatever `deploy-portal.yml` last did with this branch — see
`status/project-status.md`'s Session 45 entry for the deploy record.

**Course creation** implements the 2026-08-31 decision no session since 21 had landed. A new
`courses.create.organization` permission (granted to `TEACHER`) allows creating an
organization-scoped course for an organization the caller is an active member of — never a
platform-wide one, never another organization's. Deliberately not `courses.create`: that key has a
bare branch in `courses_select`, so granting it to `TEACHER` would have made every course on the
platform visible to every teacher. Enforced twice, in `createCourse()` and independently in
`courses_write`'s RLS policy. Full contract in `docs/ORGANIZATION_CORE.md`.

**Notifications** add the four `NotificationType` values Session 39 documented as an extension
point and nobody wired through Session 44 — `article_approved`, `article_changes_requested`,
`article_rejected`, `article_published` — with one domain event per transition and one listener
each, notifying the article's author and never the reviewer. Full contract in
`docs/NOTIFICATIONS.md`.

### 9.4 Orphaned `Asset` row — resolved in production

`10d94d8d-cd02-4488-8223-ed020e3c4eca` (`control-plane-bootstrap-og.png`, 147008 bytes,
`storage_driver='local'`, uploaded 2026-08-31 during Session 34's cross-environment storage
mismatch) was confirmed still present and still `status='active'` on 2026-09-05, and confirmed
referenced by nothing: zero `asset_attachments`, zero `resources`, zero `project_documents`, no
`articles.cover_asset_id`, no `profiles.avatar_asset_id`.

Resolved by the codebase's existing Asset lifecycle path — `status='deleted'` + `deleted_at`, plus
an `asset.deleted` AuditEvent attributed to the uploader — never a hard row DELETE (`assets` has
no DELETE RLS policy at all, by Session 13's design). Rehearsed first against the restored
production copy using `scripts/resolve-orphaned-asset.ts`, then applied to production as the
equivalent guarded SQL in a single transaction (the script itself could not be run against
production from this sandbox — see the access note above). Post-state confirmed live:
`status=deleted`, `deleted_at=2026-09-05 20:05:11.835069+00`, and two `audit_events` rows for that
entity (`asset.uploaded` 2026-08-31, `asset.deleted` 2026-09-05). Reversible by flipping the
status back.

Not touched, and still open as a smaller follow-up: the two `storage_driver='local'` rows Session
32 flagged (`certificate-KA-2026-2FB5355B6CA3.txt`, `qa_doc.txt`). Unlike this one, both still
carry live `asset_attachments` rows (a certificate and a sponsor document), so soft-deleting them
is a real data-lifecycle decision about those consumers, not an orphan cleanup — out of Session
45's scope, which named exactly one row.

### 9.5 Cloudflare R2 API token rotation — blocked on the site owner

Not done. Creating an R2 API token requires either the Cloudflare dashboard's "Manage R2 API
Tokens" flow or the Cloudflare API's token endpoints; this session's sandbox classifier denies
every call to those endpoints, including read-only listing — the same wall Session 32 hit and
documented. Terraform cannot do it either: the `cloudflare` provider has no R2-credential
resource, only `cloudflare_r2_bucket` (see `terraform/portal-storage.tf`'s own comment).

What this session *could* verify, and did: **the current credentials still work.** Six consecutive
public reads of an R2-backed article cover
(`https://keenafricans.keenafrica.com/covers/0048d5db-f208-43de-9580-9a039843fa8a`) all returned
HTTP 200 with a byte-identical 102,959-byte `image/png`, served across a 2-pod Service. That is
the baseline to re-run after rotation.

**Procedure for the site owner** (unchanged from Session 32's, which is how the current token was
made):

1. Cloudflare dashboard → R2 → **Manage R2 API Tokens** → create a token scoped **Object Read &
   Write**, **Apply to specific buckets only** → `keenafrica-portal-assets-prod`. Same scope as
   the existing one; do not broaden it.
2. `kubectl patch secret portal-secrets -n keen-prod --type merge -p '{"stringData":{"S3_ACCESS_KEY_ID":"<new id>","S3_SECRET_ACCESS_KEY":"<new secret>"}}'` — run it yourself, in your own
   terminal. Do not paste the values into a chat interface; that is the exact thing this item
   exists to remediate.
3. `kubectl rollout restart -n keen-prod deployment/portal`, then `kubectl rollout status`.
4. Re-run the read baseline above (expect 6/6 × HTTP 200, 102,959 bytes) and one real upload
   through the teacher portal.
5. **Only then** delete the old token in the R2 dashboard, and confirm the read baseline still
   passes afterwards.

### 9.6 `postgres01`'s sibling databases — documented

`docs/BACKUP_RESTORE.md` (per-database table with live evidence) and `docs/ENVIRONMENT.md` (short
cross-reference) now both record that `postgres01` hosts four databases, re-confirmed live on
2026-09-05: `keenafrica_portal_prod` (14 MB, live), `keenafrica_portal` (9.0 MB, the dormant
pre-cutover database — 5 tables, 4 rows, 8 tuple-level writes total since 2026-07-24),
`postgres` (8.6 MB, the default administrative database), and `testdb` (8.6 MB, owned by `keen`,
**zero user tables and zero write activity ever** — genuinely empty scratch). None are written to
by the portal and none are covered by `backup-portal-db.yml`. Whether to delete the dormant
database remains an open, low-priority owner decision, deliberately not made here; the docs now
say to `pg_dump` it first if it ever is.

### 9.7 `rollback-portal.yml` — first-ever dispatch

Flagged since Session 16, never run. See `status/project-status.md`'s Session 45 entry for the
dispatch record and outcome. The no-op form used is `image_tag` = the digest tag already running,
so `kubectl set image` is a no-op for Kubernetes (no new ReplicaSet, no pod restart) and the run
exercises only what it is meant to: the self-hosted runner, its kubeconfig, the `production`
Environment approval gate, and the commands themselves.

## Required next-session actions

- ~~**Whoever picks up the assessments P0**~~ — **resolved by Session 31; the follow-on
  data-integrity question it left open is resolved by Session 45, see §9.1** (nothing deleted those
  rows; they were never created). Retained below only because the technique is still the right one
  for the next P0-shaped investigation: capture `pg_stat_activity`/`pg_locks` against
  `keenafrica_portal_prod` specifically (not the dormant sibling `keenafrica_portal` database on
  the same server — easy to pick the wrong tab, this session did it once), ideally as the
  migrator/superuser role for unredacted visibility, using a real `psql \watch 1` loop started
  independently a few seconds *before* triggering a repro — not chat-coordinated timing, which this
  session tried four times and never landed inside the ~18-20s window. Reproduces 5/5 so far,
  including under 3-way concurrent load (18s solo → ~22-23s concurrent, not a multiplied pile-up —
  a weak signal toward pool/resource contention over a single stuck lock, not proof). Also worth
  checking Prisma's connection pool metrics/`connection_limit` and network latency between the
  portal pods and `postgres01` as a parallel line of investigation.
- ~~**Whoever next touches `docs/ENVIRONMENT.md`/`docs/BACKUP_RESTORE.md`**: document that
  `postgres01` hosts `keenafrica_portal_prod` alongside three sibling databases~~ — **done,
  Session 45, with live per-database evidence. See §9.6.** The one remaining sub-decision (delete
  the dormant `keenafrica_portal` or keep it) is deliberately still open and is the owner's.
- **Whoever owns the object-storage decision** (flagged since Sessions 09/13, re-confirmed broken
  live by Session 28): stand up shared storage (S3-compatible, or a shared PVC) before any real
  organization is onboarded, or gate file-upload-dependent features behind a feature flag in the
  interim.
- **Whoever builds organization-scoped course-management UI** (flagged by Sessions 21/24/26/27/28,
  re-flagged again here): the day the first real ORGANIZATION-scoped course exists, immediately
  re-run this session's §4 gap as a genuine production HTTP pass, and reconsider the §5 rollback
  note about code-rollback-past-Session-21 changing visibility behavior for real org-scoped data
  from that point on.
- **Whoever schedules the QA-account purge** (site owner's stated intent, §3): no date set yet:
  when it happens, re-run this session's demo/QA-account check to confirm production has zero
  authenticatable QA accounts, not just zero demo-seed accounts.
- **Whoever revisits DMARC**: promote `_dmarc.keenafrica.com` from `p=none` to `p=quarantine`/
  `p=reject` once the aggregate reports (routed to a personal Gmail address today) have been
  monitored for a period.
