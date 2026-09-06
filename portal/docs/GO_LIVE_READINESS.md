# Go-Live Readiness

> ## CURRENT VERDICT: **NO-GO** — Session 47, 2026-09-06
>
> The authoritative, current verdict is **[§11, Session 47's re-declaration](#11-session-47--go-live-readiness-re-declaration-2026-09-06)**.
> Four blockers: disaster recovery does not work (§11.2), automated backups are not reliably
> running (§11.3), the rollback plan is stale and its tooling asserts something now false (§11.4),
> and QA accounts can still authenticate against production (§11.5). **No product defect blocks
> launch** — every portal including Keen Africans passes its authorization boundary and Sessions
> 45's and 46's fixes are independently confirmed closed.
>
> **Blocker status as of Session 49 (2026-09-06), which did not amend this verdict:** §11.2 and
> §11.4 are **closed** with live evidence — see **[§12](#12-session-49--disaster-recovery-hardening-2026-09-06)**,
> including the fresh-PG-14.24 restore in which `kf_portal_prod_app` reads a table for the first
> time. §11.3's fix is **merged and live on `main`** (`70414ac`, 2026-09-06), but its criterion is
> **seven consecutive unattended daily backup runs**: the first one is 02:17 UTC on **2026-09-07**
> and the seventh, if none fails, is **2026-09-13** — the earliest date this item can honestly be
> re-judged. §12.2 names the two commands to check it with. §11.5 is unchanged and belongs to
> Session 48. **The verdict stays NO-GO until §11.3's seven days have actually elapsed and been
> verified.**
>
> Sections 1–10 below are Session 30's original report and the Session 31/32/45/46 updates to it,
> preserved as historical record. Where §11 contradicts them, §11 is current; where §12 updates
> §11's blocker status, §12 is current.

---

# Session 30's original report (2026-08-29)

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
| 2 | LinkedIn OAuth credentials in production | **Closed at the provider level 2026-09-06** — one human click-through left to exercise identity linking | See §9.2 below. |
| 3 | Teacher org-scoped course creation | **Closed, deployed, verified live — including through the real UI 2026-09-06** | See §9.3 below. |
| 4 | Review-workflow notifications | **Closed and deployed; one residual verification gap** | See §9.3 below. |
| 5 | Orphaned `Asset` row `10d94d8d-…` | **Closed in production** | See §9.4 below. |
| 6 | Cloudflare R2 API token rotation | **Done 2026-09-06** — rotated, reads + writes verified, old token revoked and re-verified after | See §9.5 below. |
| 7 | `postgres01`'s sibling databases documented | **Closed** | See §9.6 below. |
| 8 | `rollback-portal.yml` dispatched once | **Closed — dispatched and green** | See §9.7 below. |

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

**Deployed and confirmed in production** (`_prisma_migrations`,
`20260905100000_answers_select_join_depth_fix` finished `2026-09-05 20:17:07.939135+00`).
`pg_policy` on production now reports, for both `answers_select` and `answers_update`:
`hops_assessments=false`, `uses_course_id=true`.

Measured under the **real enforcing role** (`kf_portal_prod_app`, `NOBYPASSRLS`), EXPLAIN-only,
against real production data — the isolated teacher branch that actually changed:

| | Plan nodes | Estimated cost |
|---|---|---|
| Old (through `assessments`) | 123 | 1,312.93 |
| New (through `attempts.course_id`) | 51 | 357.72 |

And the **whole `answers_select` policy in situ**, measured on a version-matched (PostgreSQL
14.24, same as production) and statistics-matched (unanalyzed, `reltuples = -1`) restore of the
live production database, under a non-superuser RLS-enforcing role:

| | Plan nodes | Estimated cost | JIT section in plan? |
|---|---|---|---|
| Old (through `assessments`) | 131 | 255,562.87 | **yes** |
| New (through `attempts.course_id`) | 67 | 77,710.00 | **no** |

That is the meaningful result: the fix takes this policy from **above** Postgres's default
`jit_above_cost` (100,000) to **below** it — the same threshold crossing Session 31 achieved for
`attempts_select`, and the actual mechanism behind that session's P0.

**This led to a systemic finding, now also fixed — see §9.8.** The post-fix estimate on
production was initially still 273,283.92 with a JIT section, higher than the version/stats-matched
copy. The cause turned out not to be the policy shape at all, but missing table statistics — which
on investigation affected 49 of 61 tables, not just these three.

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

### 9.2 LinkedIn OAuth — RESOLVED at the provider level (2026-09-06)

> **Update — 2026-09-06.** The site owner registered
> `https://keenafricans.keenafrica.com/auth/callback/linkedin` in the LinkedIn Developer Portal.
> Re-probed immediately: **LinkedIn now accepts the full authorization request.** Both legs of
> the flow are verified against production; the only step not exercised is a human completing a
> real LinkedIn login, which is what the "Remaining" note at the end of this section covers.
>
> **Outbound leg — verified live against production**, by driving the real Server Action on
> `keenafricans.keenafrica.com` (the Google button on the public login page, which uses the
> identical `signIn()` mechanism):
> - emits `redirect_uri=https://keenafricans.keenafrica.com/auth/callback/google` — the correct
>   host, matching the registered LinkedIn string exactly. This confirms in production what had
>   only been shown by local reproduction.
> - stores `__Secure-authjs.callback-url = https://keenafricans.keenafrica.com/dashboard` — an
>   **absolute URL on the real host**. That cookie is what the callback route redirects to on
>   success, so the return leg lands correctly too.
>
> **LinkedIn's side — verified by following the authorization request through**: it now answers
> `303` to LinkedIn's own sign-in/consent page (`pageKey:
> d_checkpoint_lg_consumer_login_oauth`), carrying a flow blob that shows every parameter
> accepted — `appId 266117470`, `scope "openid profile email"` (so the "Sign In with LinkedIn
> using OpenID Connect" product is genuinely active — an inactive product returns
> `unauthorized_scope_error` here), `redirectUri
> https://keenafricans.keenafrica.com/auth/callback/linkedin`, `authorizationType
> OAUTH2_AUTHORIZATION_CODE`, `authFlowName generic-permission-list`. No error text anywhere on
> the page.
>
> **On the `0.0.0.0:3000` error redirect, so it isn't mistaken for a new problem**: hitting
> `/auth/callback/linkedin` with a bogus `code`/`state` redirects to
> `https://0.0.0.0:3000/auth/error?error=Configuration`. **Google does exactly the same thing**
> under the identical probe, and Google sign-in is verified working end-to-end in production —
> so this is the known cosmetic quirk on the raw Auth.js routes (see the root-cause note below),
> reached only on the *error* path, not the success path. `error=Configuration` here is an
> artifact of the deliberately invalid state, not a provider misconfiguration.
>
> **Remaining, and genuinely worth doing once**: a human completing a real LinkedIn login and
> consent. That is the only way to exercise `resolveLinkedInSignIn()`'s identity linking and the
> verification-status flip to `linkedin_connected` against real LinkedIn profile data — logic
> that has never run against the real provider. Expect: LinkedIn consent → back to
> `/account?linkedinConnected=1` → a `user_identities` row with `provider='linkedin'` → the
> account's verification status showing `linkedin_connected`, pending admin review.

The original finding, kept for the record:

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

#### Is registering that URL actually sufficient? Yes — proven, not assumed (2026-09-06)

The obvious worry: hitting Auth.js's raw `/auth/signin/<provider>` REST endpoint emits
`redirect_uri=https://0.0.0.0:3000/auth/callback/<provider>` — the long-flagged, repeatedly
re-investigated Auth.js host-resolution quirk (Session 30 §8,
`docs/QA_AUTHENTICATION_LIVE_PASS.md` item 3). If the real button emitted that too, registering
the correct URL in LinkedIn would change nothing and the fix would be a code change instead. That
question was settled by reproduction rather than left open a fourth time.

**Method**: the production runtime was reproduced locally — the same `output: "standalone"` build,
started through the same `server-entrypoint.js` the container uses — and both paths were driven
with `curl` against a `keenafricans.*` Host header.

| Path | Emitted `redirect_uri` |
|---|---|
| Raw REST endpoint, `POST /auth/signin/linkedin` | `http://0.0.0.0:3100/auth/callback/linkedin` ❌ |
| The real **"Connect LinkedIn" button** (server-side `signIn()` in a Server Action), driven as a logged-in Keen African | `http://keenafricans.portal.local/auth/callback/linkedin` ✅ |
| Same button, with `X-Forwarded-Proto: https` (what Traefik sends) | scheme correctly becomes `https://…` ✅ |

So the two paths genuinely differ, and only the unused one is broken. **Root cause of the raw-path
quirk, for the record**: Next.js's standalone `server.js` does
`const hostname = process.env.HOSTNAME || '0.0.0.0'`. `server-entrypoint.js` deletes `HOSTNAME`
(to stop Kubernetes' pod-name injection leaking into redirect URLs), which makes that fall through
to the literal `'0.0.0.0'`, and the raw Auth.js route builds its absolute URL from the bound
address rather than the request. The Server Action path doesn't go through that route at all — it
resolves the host from the request headers, which is why Google sign-in has always worked in
production.

**Conclusion: no code change is needed.** Registering
`https://keenafricans.keenafrica.com/auth/callback/linkedin` is sufficient and will make "Connect
LinkedIn" work. The `0.0.0.0` quirk is cosmetic, affects only an endpoint nothing calls, and is
deliberately left alone — changing server startup or Auth.js URL resolution to tidy it carries
real risk for zero user-facing gain.

**Still re-test through the real button, not curl against the raw endpoint** — the raw endpoint
will keep showing the bad `redirect_uri` afterwards and would mask a successful fix.

### 9.3 Teacher org-scoped course creation, and the review-workflow notifications

Both shipped in PR #89, merged to `main` and deployed to production on 2026-09-05 (run
33989528071, image `9a19fc48bef4c61f8115cc68cc63989286ece844`, all three migrations applied at
20:17:07-08 UTC). Both were also pre-flighted before deploy against a **restored copy of the live
production database** and are covered by tests against the real non-superuser `portal_rls_test`
role.

**Course creation — verified live in production twice over: through the real UI, and at the RLS
layer.**

**Through the UI (2026-09-06, the strongest evidence).** The site owner, logged in as
`adebiyibanbo+qa.teacher@gmail.com` (global role `TEACHER`, active `org_admin` of `QA Test Org
(Session 22)`), created a course through the teacher portal's own "New organization course" form.
Result in production: course `09037e48-823b-4e13-ad09-f11d9969c428` — `scope = organization`,
`organization_id = 2f440a07…` (QA Test Org (Session 22)), `status = draft`,
`created_by = <the teacher>`, with a matching `course.created` AuditEvent. That is the whole
feature working end to end for a real user: permission → Server Action → `createCourse()` →
`courses_write` RLS → `INSERT … RETURNING` through `courses_select`'s new `created_by` branch.

**At the RLS layer**, separately, against the real enforcing `kf_portal_prod_app` role. Each probe
set `app.permissions`/`app.organization_ids` by hand — i.e. it simulates a crafted request that
never went through the application code — and ran inside a transaction that was rolled back, so no
row was created.

| Case (session variables set explicitly) | Expected | Result |
|---|---|---|
| Holds `courses.create.organization`, row scoped to an org in `app.organization_ids` | allowed | **INSERT succeeded, and `RETURNING` returned the row** — which also proves `courses_select`'s new `created_by` branch, since Postgres applies SELECT policies to `INSERT … RETURNING` |
| Same, but a **platform-wide** row (`scope='platform'`, `organization_id NULL`) | refused | `ERROR: new row violates row-level security policy for table "courses"` |
| Same, but row scoped to `TS Attempted Org` — an organization neither QA account holds any membership row for | refused | same RLS error |
| `app.permissions` **without** `courses.create.organization` | refused | same RLS error |

> **Correction (2026-09-06).** An earlier revision of this section named the wrong QA account for
> these probes: it called user `9ece7390…` "the QA teacher" when that id is in fact
> `adebiyibanbo+qa.student@gmail.com`; the teacher is `bb133a3c…`. **No conclusion changes** —
> `courses_write`'s new branch reads only `app.permissions`, `scope`, `organization_id` and
> `app.organization_ids`, never `app.user_id`, so each probe's outcome was determined entirely by
> the session variables set for it, which were correct in every case. Only the fixture labels were
> wrong. The table above is restated in terms of the session variables actually set, which is what
> the policy actually evaluates. For anyone reproducing this: the useful fixture is
> `adebiyibanbo+qa.teacher@gmail.com` — active `org_admin` of `QA Test Org (Session 22)` and
> **`removed`** from `QA Test Org B (Session 24)`, so it gives a genuine positive and a genuine
> cross-tenant negative from one account. `adebiyibanbo+qa.student@gmail.com` is active in both
> orgs and is therefore *not* a valid cross-tenant negative.

Note on what RLS can and cannot do here: `app.organization_ids` is a **server-resolved** session
variable — `withRls()` derives it from `OrganizationMembership`, never from client input. A probe
that sets it by hand is simulating an actor who already holds direct database credentials, at
which point RLS was never the boundary. That is precisely why `createCourse()` independently calls
`isActiveOrganizationMember()` rather than trusting the session variable: the two layers answer
the question separately, and the application-layer half is covered by
`organization-aware-education.test.ts`'s positive/negative/pending-membership cases.

**Notifications — deployed and confirmed present in the running image**, but with one residual
verification gap. Confirmed in production: all four enum values exist on the live
`NotificationType` type (`article_approved`, `article_changes_requested`, `article_rejected`,
`article_published`), and `kubectl exec` into the running pod shows each of the four appearing in
the compiled server chunks of the deployed build. **Not verified**: an end-to-end review cycle
against production, because doing so means creating a real article, submitting it, and having an
admin approve/reject it — real production content this session declined to manufacture. The
behaviour itself is covered by 8 tests in `notifications.test.ts` (recipient is the author and
never the reviewer; the reviewer's note/reason reaches the body; a
changes-requested → resubmit → approved cycle produces two distinct notifications; the Session 39
opt-out preference suppresses them; a self-publish stays silent; a reviewer-on-behalf publish and
a scheduled publish each notify with the right wording). **A two-minute owner-side close-out**:
submit any draft for review from `keenafricans.keenafrica.com`, approve it from the admin console,
and confirm the notification bell shows it.

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

### 9.5 Cloudflare R2 API token rotation — DONE (2026-09-06)

> **Rotated and verified.** The site owner created a replacement R2 API token (Object Read &
> Write, scoped to `keenafrica-portal-assets-prod` only — same scope as the original, deliberately
> not broadened) and applied it with `~/rotate-r2-token.sh`, which reads the credentials with
> hidden input and hands them to `kubectl` through a `0600` temp file so they never reach a chat
> interface, a shell history, or a process list. That was the whole point of this item: the
> Session 32 token's values had been pasted into a chat interface twice during setup.
>
> **Rollout**: new ReplicaSet `portal-5bf6fd5d97`, both pods replaced, `RESTARTS 0`, old
> ReplicaSets scaled to zero, `restartedAt 2026-09-06T09:39:54Z`. The image did not change — this
> was purely a credential rotation. All 14 keys still present in `portal-secrets` (the merge patch
> touched only the two S3 keys). A backup of the pre-rotation Secret was taken first, since
> Cloudflare shows an R2 secret access key exactly once.
>
> **Reads verified — and verified properly.** 12 requests for an R2-backed article cover, all
> HTTP 200 / 102,959 bytes. Crucially, four of those were **cache-busted with unique query
> strings** and every response carried `cf-cache-status: DYNAMIC`, so they genuinely reached the
> pod and the pod genuinely reached R2 — a plain read could have been served from Cloudflare's
> edge and proven nothing. All four were byte-identical (`sha256 ff2c41cf…`).
>
> **Writes verified by a real upload**, which is the half reads cannot prove (a read-only-scoped
> token passes every read test and still fails the first `PUT`). The site owner uploaded a real
> file through the teacher portal: asset `55a2b071-c43a-42a8-8641-b5fa93fbf07f`, 217,325 bytes,
> `application/pdf`, **`storage_driver = 's3'`**, attached as a `lesson_resource`, with
> `asset.uploaded` and `resource.added` AuditEvents 78 ms apart.
>
> That the row exists is itself conclusive proof the R2 write succeeded:
> `src/lib/assets.ts`'s `uploadAsset()` `await`s `driver.put()` **before** creating the row, and
> the S3 driver throws on any non-2xx — so the row cannot exist unless R2 accepted the bytes under
> the new credential. Zero storage errors in the pod logs throughout (Session 32 added
> `console.error` on every driver failure path, so a bad credential would be loud).
>
> **Old token revoked (2026-09-06), and re-verified after the fact.** Re-checking after a
> revocation matters: revoking the wrong one of two similarly-named tokens breaks every upload and
> download instantly, with no restart needed, because R2 credentials are used per request. Six
> cache-busted reads (`cf-cache-status: DYNAMIC` on all of them, so genuinely origin→R2) returned
> HTTP 200 / 102,959 B / identical `sha256` after the revocation, with zero storage errors in the
> logs and all five portals at 200.
>
> That check was strengthened by coincidence: PR #92's deploy landed at 09:50, so the pods were
> rebuilt and restarted *after* the revocation and re-read the Secret from scratch — the surviving
> credential is unambiguously the new one, and it works.
>
> **Item 6 is fully closed.** One optional piece of hygiene remains for the site owner: `shred -u`
> the pre-rotation Secret backup (`~/portal-secrets-backup-<timestamp>.yaml`). Nothing unique is
> lost by deleting it — the only value in it that is not still live in `portal-secrets` is the
> now-revoked R2 token — but it holds every other production secret in base64, so it should not
> sit around.

The original finding, kept for the record:

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

Flagged since Session 16, never dispatched once. **Dispatched 2026-09-05 with the site owner's
explicit go-ahead, and it worked.**

Run [33990023377](https://github.com/Bambocharles/keenafrica/actions/runs/33990023377),
`image_tag = 9a19fc48bef4c61f8115cc68cc63989286ece844` — deliberately the digest already running,
so `kubectl set image` is a no-op for Kubernetes. Conclusion **success**, job duration ~0.3s.

What the run proved: the `self-hosted, keenafrica-vm` runner label resolves (job ran on
`keenafrica-infra`); the `production` GitHub Environment approval gate engages (the run sat in
`waiting` until approved); `KUBECONFIG=/home/keen/.kube/config` is valid and the runner's kubectl
can reach and mutate `deployment/portal` in `keen-prod`; and all three commands
(`set image`, `annotate`, `rollout status`) succeed — `deployment.apps/portal annotated`,
`deployment "portal" successfully rolled out`.

Confirmed a genuine no-op afterwards: the same ReplicaSet (`portal-74d546c88d`) still serves both
pods, pod ages unchanged (8m, i.e. created by the earlier deploy, not by this run), `RESTARTS 0`,
no new ReplicaSet created. The only persistent effect is the deployment's `change-cause`
annotation, now `ROLLBACK to ghcr.io/bambocharles/keenafrica-portal:9a19fc48…`. All three portals
(`keenafricans`/`teacher`/`admin`) returned HTTP 200 immediately after.

**What this run did not exercise**, and should not be mistaken for: an actual image change and
therefore an actual pod replacement. A real rollback additionally depends on the target image
still existing in GHCR and on the schema being compatible with it — the compatibility caveat
`docs/PRODUCTION_HARDENING.md`'s runbook already states (this workflow never touches the
database). Testing that end of it means deliberately restarting production twice, which was
offered and not chosen.

## 10. Systemic finding: production had never been ANALYZEd (2026-09-06)

Found while verifying §9.1's fix, fixed the same day with the site owner's go-ahead. This was not
in Session 45's brief; it is recorded here because it is the same *class* of defect as Session
31's P0 and materially changes the platform's risk picture.

### What was wrong

**49 of 61 user tables in `keenafrica_portal_prod` had never been analyzed** — `reltuples = -1`,
`relpages = 0`, both `last_analyze` and `last_autoanalyze` NULL. Autoanalyze had never fired and,
at these row counts, never would have: its threshold is 50 changed rows
(`autovacuum_analyze_threshold`), and the largest table held 40.

With no statistics, Postgres plans against default row estimates. That is normally a minor
inefficiency. It is not minor in this schema: the RLS policies nest `EXISTS` subqueries three to
four tables deep, so a default estimate multiplies out through the whole policy tree into a plan
whose **estimated** cost crosses Postgres's `jit_above_cost` (100,000) — at which point Postgres
JIT-compiles the entire expression tree before executing a query that returns almost nothing.
Exactly the mechanism Session 31 root-caused for `attempts_select`.

Six tables were over the threshold, measured live under the real `kf_portal_prod_app` role:

| Table | Est. cost | JIT? | Actual rows |
|---|---|---|---|
| `assets` | 857,784 | yes — over `jit_optimize_above_cost` (500,000) too | 6 |
| `asset_attachments` | 502,936 | yes — same | 4 |
| `modules` | 249,750 | yes | 1 |
| `resources` | 188,353 | yes | 1 |
| `courses` | 180,616 | yes | 1 |
| `lessons` | 176,749 | yes | 1 |

The worst was measured for real, not just estimated: `EXPLAIN (ANALYZE) SELECT id FROM assets`
took **15,399.711 ms, JIT-compiling 4,796 functions — on a 6-row table.** For comparison, Session
31's P0 was 2,148 functions and 6.7s.

**It was not a live outage, and that distinction matters.** Every `asset` query in `src/` is
`findUnique({ where: { id } })`, which planned at ~11 ms throughout; no application code path
issues an unfiltered scan. This was a landmine, not a fire — but Prisma's interactive-transaction
timeout is 5s, so the first `findMany` over `assets` anyone added would have reproduced Session
31's P0 on a different table.

### The fix

A single database-wide `ANALYZE;` — statistics only, no data or schema change. **996 ms** for the
whole database. Every user table is now analyzed (`still_never_analyzed = 0`).

Verified by re-running the same sweep under the same role. **No table has a JIT section any more,
and every plan improved — none regressed:**

| Table | Before | After |
|---|---|---|
| `assets` | 857,784 (JIT) | 1,246 |
| `asset_attachments` | 502,936 (JIT) | 799 |
| `modules` | 249,750 (JIT) | 111 |
| `resources` | 188,353 (JIT) | 112 |
| `courses` | 180,616 (JIT) | 113 |
| `lessons` | 176,749 (JIT) | 111 |
| `assessments` | 72,272 | 49 |
| `questions` | 57,816 | 48 |
| `certificates` | 54,204 | 47 |
| `cohorts` | 27,600 | 37 |
| `users` | 27,450 | 176 |
| `enrollments` | 12,912 | 38 |
| `answers` | 273,284 (JIT) | 0.00 |

And the real-world measurement, same query as above: **15,399.711 ms → 10.896 ms**, no JIT
section. All five portals returned HTTP 200 in ~0.1s afterwards; R2-backed cover reads unchanged
(3/3, byte-identical).

### The part that would have brought it straight back

`scripts/backup/pg-restore.sh` did **not** run `ANALYZE`. A dump does not carry statistics, so
every restored table comes up with `reltuples = -1` — meaning a real disaster-recovery restore of
production would have come up in exactly the pathological state described above, and stayed there,
because autoanalyze would never fire. That is now fixed: the restore script runs `ANALYZE` on the
target as its final step, and `scripts/backup/test-restore-drill.sh` passes with it in place.

**This matters for Session 48** (production data purge and relaunch): any purge/reload path must
end with `ANALYZE`, or it re-creates this problem on a freshly emptied database.

### What is still worth doing

- ~~**Session 46**: this fix removes the *current* exposure but not the underlying fragility — RLS
  policies three to four tables deep are inherently one bad row-estimate away from the JIT
  threshold. The policy-depth reduction Sessions 31 and 45 applied to `attempts_select` and
  `answers_select` (denormalise, join directly, drop the redundant hop) is the durable fix and
  has not been applied to `assets_select`/`asset_attachments_select`, which are the two deepest
  remaining (83 and 82 plan nodes even when cheap).~~ — **DONE by Session 46, differently and
  more completely than expected.** Session 46 enumerated all 52 RLS policies at 3+ table depth
  and found the denormalisation pattern **provably does not transfer** to `assets_select`/
  `asset_attachments_select`: unlike `attempts.course_id` (immutable), asset visibility is
  *dynamic* (it tracks the linked entity's live RLS), so there is no stable column to denormalise
  without a cache-invalidation system. The durable fix applied instead is `jit = off` at the
  database level (migration `20260906120000_disable_jit_deep_rls_policies`), which removes the
  entire class for all 52 policies at once with provably identical query results (plans unchanged,
  compile step skipped) — `assets` at 1,000 rows went from 1,595 ms / 4,717 JIT functions to
  20.7 ms / 0. `pg-restore.sh` re-applies it after a restore. Full audit:
  `docs/SECURITY_RLS_AUDIT_S46.md`. **DEPLOYED to production 2026-09-06** (PR #93 → `main`
  `2d395a8` → `deploy-portal.yml` run `34029642801`, success; migration applied per the run
  log). **Verified live:** `SHOW jit` on `keenafrica_portal_prod` returns `off`. Session 46 also
  found and fixed an unrelated live-exploitable P1 (`X-Forwarded-For` spoofing defeating every
  IP-based rate limit — report-flood, view inflation, weakened login-IP limit); fix in
  `src/lib/client-ip.ts`, **deployed in the same rollout and verified live** (six rotating
  `X-Forwarded-For` hits with a fixed User-Agent now increment the view counter by 1, not 6 —
  the spoofed prefixes collapse to one `CF-Connecting-IP`).
- **Ongoing**: autoanalyze will maintain these tables correctly once any of them exceeds ~50 rows.
  Below that it will not fire, but statistics are now accurate rather than absent, which is the
  condition that actually caused the problem.


## 11. Session 47 — Go-Live Readiness Re-Declaration (2026-09-06)

> **VERDICT: NO-GO.** Four blockers, all newly established with live evidence this session, none
> of them known before today. Three of the four are in disaster recovery and incident response —
> the parts of the system that have never been exercised. Nothing in the *product* surface blocks
> launch: every portal including Keen Africans passes its authorization boundary, the test suite
> is green, and Sessions 45's and 46's fixes are independently confirmed closed. What blocks
> launch is that **the platform cannot currently be restored, is not reliably being backed up, and
> cannot safely be rolled back** — and the QA-account exception Session 30 named is still open.

### 11.0 Precondition check — passed

Session 46 (Full-Platform Security & RLS Audit) reports **"No finding remains open, and both
fixes are now live."** Read in full, not just the summary line: F1 (`X-Forwarded-For` spoofing)
and F2 (deep-RLS JIT) are both fixed, merged as PR #93 → `main` `2d395a8`, deployed via
`deploy-portal.yml` run `34029642801` (success), and verified live. Independently re-confirmed
this session: `kubectl -n keen-prod get deploy portal` reports the running image as
`ghcr.io/bambocharles/keenafrica-portal:2d395a8035f447d22b23146dc643c6e76b3d94c7` — the Session 46
merge commit itself. **This session was not blocked by its precondition.**

### 11.1 Evidence standard — what this session could and could not do

Same standard Session 30 set: live HTTP, real DNS, real workflow logs, real production data.
Stated plainly, because it bounds several verdicts below:

- **Available**: public HTTPS against all five production hosts; `kubectl` read access to
  `keen-prod`; `gh` (workflow runs and logs); Docker; and **today's real production dump**
  (`portal-20260906T095712Z.dump`, `pg_dump` of `keenafrica_portal_prod` at 09:57:12 UTC, PG 14.24
  — 61 tables, 196 policies, real production row counts). Every "production data" claim below was
  measured against a restore of that dump, not recalled from a prior session's document.
- **Not available**: direct connections to `keenafrica_portal_prod` (classifier-blocked in this
  sandbox, in every form attempted — the same intermittent wall Sessions 45 and 46 documented);
  `kubectl get secret` value reads; **and therefore any authenticated production session at all**.
  QA account passwords are deliberately never given to an agent (`docs/QA_LIVE_TEST_ACCOUNTS.md`:
  they live in the site owner's password manager and in a credential-vault Secret outside the
  app's `envFrom`). This is correct security design, and it means **no portal below carries an
  authenticated live sign-off from this session.** That limitation is named per-area in §11.7
  rather than papered over.

### 11.2 BLOCKER 1 — Disaster recovery does not work. First real restore test, and it failed.

`docs/BACKUP_RESTORE.md` has claimed a working restore procedure since Session 01. The
`test-restore-drill.sh` drill only ever proved that a synthetic database round-trips through the
two scripts; the daily workflow only ever proved that a dump *can be read back* by a PG 16
superuser. **A restore of real production data into a target shaped like production had never been
performed.** It has now. It does not work.

Method: today's real production dump, restored into a disposable **PostgreSQL 14.24** container —
byte-for-byte the same server version as production (`PostgreSQL 14.24 on x86_64-pc-linux-musl`)
— using the project's own `scripts/backup/pg-restore.sh`, following `docs/BACKUP_RESTORE.md`'s
runbook as literally written.

**(a) A restore into a fresh database produces a database the application cannot read at all.**

The runbook's step 2 says to confirm the target database exists and that `pgcrypto`/`citext` are
present. That is the entire preparation it specifies. Doing exactly that and restoring, the
application's runtime role is left with **zero privileges on every table**:

```
$ psql -d "postgresql://kf_portal_prod_app@.../dr_fresh" -Atc "select count(*) from users"
ERROR:  permission denied for table users

$ select count(*) from information_schema.role_table_grants where grantee='kf_portal_prod_app';
 0
```

Cause: `pg-backup.sh` dumps with `--no-privileges` and `pg-restore.sh` restores with `--no-owner
--no-privileges`, so no `GRANT` is carried. The grants production actually runs on come from
`~/portal-db-setup-prod.sh` (`GRANT USAGE ON SCHEMA public` plus `ALTER DEFAULT PRIVILEGES FOR
ROLE kf_portal_prod_migrator …`), and `ALTER DEFAULT PRIVILEGES` is per-database catalog state
(`pg_default_acl`) — also not in a dump, for the same reason statistics and `jit=off` are not.
The runbook never mentions roles, grants, or default privileges. **Following it after a total loss
gives you a database with all your data in it that the portal cannot serve a single row from.**

**(b) `pg-restore.sh` aborts before its own ANALYZE and `jit=off` steps whenever `pg_restore`
reports any ignorable error** — silently reinstating both pathologies Sessions 45 and 46 fixed.

`pg_restore` exits non-zero on *ignorable* errors ("errors ignored on restore: 4" — here, four
harmless extension-ownership `DROP EXTENSION`/`COMMENT` failures that occur whenever the
extensions were created by a different role than the one restoring, which is exactly what the
runbook's step 2 produces). The script runs under `set -euo pipefail`, so it exits 1 at that
point and never reaches its last two steps:

```
pg-restore.sh exit code: 1
never_analyzed=16 of 61 tables        # Session 45's fix did not run
show jit  ->  on                      # Session 46's fix did not run
pg_db_role_setting rows for the DB: 0
```

Both of those steps exist *specifically* because a dump does not carry them, and both are
defended in long comments in the script. They are skipped precisely in the scenario they were
written for. Measured honestly: at today's row counts the *consequence* stays latent — the
`assets` plan under the RLS role costs ~1,561, far below `jit_above_cost`, so the multi-second
JIT compilation does not currently reproduce. Session 46 puts the crossover at ~465 rows for
`assets_select`. **The defect is structural and certain; its performance impact is bounded by
current data volume and would appear as the platform grows.** Named as bounded, not inflated.

**(c) PostgreSQL 14's `pg_restore` cannot read the backups at all.**

Production is PG 14.24. Dumps are written by `pg_dump` 16.14 (archive format 1.15), because both
scripts default to `PG_IMAGE=postgres:16-alpine` — directly against that variable's own
documented contract, *"Keep this in sync with the server's major version."*

```
$ PG_IMAGE=postgres:14-alpine ./scripts/backup/pg-restore.sh <today's prod dump> <PG14 target>
pg_restore: error: unsupported version (1.15) in file header
```

It works today only because the scripts happen to default to a PG 16 container. Anyone recovering
with tooling matched to the production server — the `psql`/`pg_restore` actually installed on
`postgres01`, or a rebuilt PG 14 host — is stopped dead by a one-line error, during an incident.

**(d) The daily verification cannot catch any of (a), (b) or (c) — by construction.**

`backup-portal-db.yml`'s verify step restores into a `postgres:16-alpine` container **as the
`postgres` superuser**, then asserts `count(*) FROM users` and `count(*) FROM pg_policies`. A
superuser bypasses the missing grants entirely, so (a) is invisible to it; it never uses the
production major version, so (c) is invisible to it; and it never inspects `jit` or statistics,
so (b) is invisible to it. The check that was supposed to make "a backup that fails to restore
fails the workflow" true is testing a scenario that resembles disaster recovery only superficially.

**What did work, and is worth recording**: an **in-place** restore over a target already carrying
production's roles and `ALTER DEFAULT PRIVILEGES` completes correctly — exit 0, `jit=off` applied,
0 of 61 tables unanalyzed, 244 grants present, and the RLS-scoped app role connects and correctly
returns 0 rows with no session context. Restoring *over the existing production database* (the
runbook's step 4, the likely case for a bad migration or a bad `DELETE`) is sound. It is
**total-loss recovery onto fresh infrastructure that is broken**, and that is the case backups
exist for.

### 11.3 BLOCKER 2 — Automated backups are not actually running daily

`backup-portal-db.yml` is scheduled at 02:17 UTC daily. Its real run history (`gh run list`) since
2026-08-27, against the dumps actually on disk:

| Outcome | Count | Dates |
|---|---|---|
| Succeeded | 4 | 08-30, 08-31, 09-02, 09-05 |
| Failed (backup taken, **verification failed**) | 3 | 08-27, 09-03, **09-06 (today)** |
| **Never ran** — still `waiting` | 4 | 08-28, 08-29, 09-01, 09-04 |

**Four days have no backup at all.** Those runs are queued behind `environment: production`'s
manual-approval gate and were never approved; they sit in `waiting` indefinitely (one for 213
hours). A scheduled job that silently requires a human to approve it is not an automated backup.
The successful runs took 2–28 hours wall-clock for the same reason — they are approval latency,
not work.

The three failures are a race in the verification step, not a bad dump: it polls `pg_isready`,
which answers during the postgres image's temporary init server, so the following command lands
either before the database exists or while that temp server is shutting down —
`FATAL: database "verify" does not exist` (today) and `FATAL: the database system is shutting
down` (09-03). Both dumps are on disk and readable.

Net effect: over the last 11 scheduled days, **7 produced either no backup or no verified one**,
and the "failure is the alert" design has been alerting into a void.

### 11.4 BLOCKER 3 — The rollback plan is stale, and the rollback tool asserts something now false

Session 30 §5 concluded that code rollback was safe "all the way back to pre-Session-17, without
any schema rollback." `rollback-portal.yml`'s own header still states the underlying claim:

> *"this is only safe when every migration between the target and the current revision was
> additive, **which is true of every migration in this repo to date**."*

Re-walked all **34 migrations from Session 21 onward**, including the 23 added by the Keen
Africans build-out. Thirty-two are purely additive. **Two are not**, and both landed after Session
30 wrote that conclusion:

| Migration | Session | Shape | Consequence of rolling code back past it |
|---|---|---|---|
| `20260831100000_attempts_course_id_denormalization` | 31 | `ADD COLUMN course_id` → backfill `UPDATE` → **`SET NOT NULL`** | `src/lib/attempts.ts:196` supplies `courseId` on insert (added by Session 31, `1b316d3`). Older images do not. **Every new assessment attempt fails** on a NOT NULL violation. |
| `20260901130000_keen_africans_article_author_name` | 36 | `ADD COLUMN author_name` → backfill `UPDATE` → **`SET NOT NULL`** | `src/lib/articles.ts:374` supplies `authorName` via `resolveAuthorName()`. Older images do not. **Every article creation fails** — Keen Africans publishing is dead. |

Because `rollback-portal.yml` deliberately (and correctly) does not touch the database, the schema
keeps enforcing both `NOT NULL`s while the rolled-back image stops satisfying them. **The true
safe rollback floor is Session 36, not "all the way back."** No data is at risk in either case —
both columns are derived and reconstructible — but an operator following the current runbook
during an incident would roll back to a "known good" image and silently break core writes.

### 11.5 BLOCKER 4 — QA accounts: resolved, and the answer is that the item does not pass

Session 30 recorded this as a site-owner-accepted, time-bound exception with no date. Session 47
was asked to resolve it rather than accept it again. Measured against real production data
(restore of today's dump) rather than against `docs/QA_LIVE_TEST_ACCOUNTS.md`:

**Production contains 13 user accounts. Twelve of them are QA test accounts.**

| Class | Count | Can authenticate |
|---|---|---|
| Real user (site owner, `SUPER_ADMIN` + `TEACHER` + `KEEN_AFRICAN`) | 1 | yes |
| QA accounts, `status = active` | 9 | **yes** |
| QA accounts, `status = suspended` | 3 | no |

Among the nine active ones is `adebiyibanbo+qa.superadmin@gmail.com` — `is_super_admin = true`,
bcrypt password set, unsuspended. **A live, password-authenticating super-admin test account
exists in production today.** One of the suspended ones is literally named *"QA Disposable
(Session 25, delete me)"*.

The demo/seed half of the item still holds and was re-confirmed at the code level:
`assertDemoSeedAllowed()` refuses in `NODE_ENV=production` and by `DATABASE_URL` pattern, its
tests pass in this session's run, and `deploy-portal.yml` never invokes the demo seed. The
production data confirms it — there is no synthetic demo user in the 13.

**Resolution (site owner, this session)**: the exception is **re-confirmed with a real terminating
event attached — Session 48**, which owns the full production purge and creates a single fresh
super-admin. This is no longer "a future date, not yet scheduled": it is the next session, gated
only on the blockers above. The site owner declined an interim suspension of the QA super-admin,
and this session deliberately did **not** mutate production accounts — Session 48 owns that
boundary, and purging now would destroy fixtures a follow-up session may need.

**This item therefore still does not pass as worded**, and it is recorded as a blocker rather than
an exception, because "no QA account can authenticate against production" is false today. It is
the one blocker here that is cleared *by* going live rather than *before* it — see the sequencing
note in the verdict.

### 11.6 Session 30's original checklist, re-walked item by item

| Item | Status | Evidence gathered this session |
|---|---|---|
| Passwords hashed | ✅ Confirmed on real production data | All 13 production `password_hash` values are `$2a$12$…` — bcrypt, cost 12. Measured, not recalled. |
| Secrets externalized | ⚠️ App-level yes; **host-level no** | App reads everything via `envFrom: portal-secrets`; the deployment defines exactly one plain env var (`ROOT_DOMAIN`). But production DB credentials sit in plaintext in world-readable `~/portal-db-setup-prod.sh` (mode 0775), and the `cloudflared` tunnel token is visible in the process command line to any local user. See §11.8 N2. |
| Encryption at rest | ❌ Still absent, now with a second location | Unchanged since Session 01 for `postgres01`'s ZFS pool. Additionally: backup dumps are `-rw-r--r-- root:root` on plain ext4/LVM on this runner (`no dm-crypt/LUKS devices present`). See §11.8 N1. |
| TLS / secure transport | ✅ at the edge, ⚠️ origin | HSTS `max-age=31536000; includeSubDomains; preload` live on all five hosts. Traefik's ingress uses entrypoint `web` (HTTP only) — TLS terminates at Cloudflare and origin traffic is plaintext over the private LAN. |
| Server-side authorization | ✅ | Every protected route on all five portals rejects anonymous access (§11.7). 894/895 tests pass, including the full RLS integration suite against the real non-superuser `portal_rls_test` role. |
| RLS / ownership boundaries | ✅ re-confirmed structurally | 196 policies present in the real production schema (counted in the restore). Session 46's 52-policy depth audit is the current authority and is closed. |
| Audit logging | ✅ extended correctly by Keen Africans | 38 `recordAuditEvent()` call sites across the six Keen Africans modules (`articles` 17, `profiles` 6, `reports` 5, `verification` 4, `follows` 3, `comments` 3) — the canonical helper, no parallel audit system. Confirmed *actually firing* in production: `article.updated` ×10, `article.published` ×5, `article.unpublished` ×4, `article.cover_set` ×3, `article.created` ×2, plus email-verification events. |
| Session revocation | ✅ | `src/lib/sessions.ts:93` rejects on `revokedAt`/expiry at every session resolution; revocation is idempotent (`:201`). Covered by the passing suite. |
| Rate limiting | ✅ and materially stronger than at Session 30 | Session 46's `resolveClientIp()` is used at **all 5** IP-keyed call sites, and **zero** raw `x-forwarded-for` reads remain outside `client-ip.ts`. Its premise is sound from the internet (§11.6a). |
| Secure uploads | ✅ | `src/lib/assets.ts` enforces a MIME allowlist with content sniffing (`ALLOWED_MIME_TYPES` + `Sniffer`), server-side. Storage confirmed on the shared S3/R2 driver in production — all 4 assets created since Session 32's fix are `storage_driver='s3'`, most recent today. |
| No sensitive logs | ✅ swept, not assumed | 12 `console.*` call sites in non-test source; **zero** mention `password`, `secret`, `token`, `hash`, `credential`, `otp`, `apikey`, `authorization` or `cookie`. |
| No demo/QA account in production | ❌ **Blocker** | Demo/seed half holds; QA half does not. §11.5. |
| Security headers | ✅ consistent across all five hosts, ⚠️ CSP report-only | HSTS, `x-frame-options: DENY`, `nosniff`, `referrer-policy`, `permissions-policy` present and byte-identical on admin/teacher/student/sponsor **and keenafricans**. CSP remains `content-security-policy-report-only` with `script-src 'self' 'unsafe-inline'` — not enforcing. Unchanged known gap. |
| Transactional email (DKIM/SPF/DMARC) | ✅ configured, ⚠️ DMARC still monitor-only | Re-verified live by `dig` today: SPF `v=spf1 include:amazonses.com ~all` on `send.keenafrica.com`, MX `feedback-smtp.eu-west-1.amazonses.com`, a published `resend._domainkey` RSA key, DMARC `v=DMARC1; p=none; …; adkim=r; aspf=r`. Correct relaxed-alignment setup; still `p=none` **and `sp=none`**, i.e. not enforcing. No fresh live send was triggered (no authenticated path available). |
| Backup / restore | ❌ **Blocker** | §11.2, §11.3. |
| Rollback plan | ❌ **Blocker** | §11.4. |

#### 11.6a One bounded qualification to Session 46's F1 fix

Session 46 fixed IP spoofing by preferring `CF-Connecting-IP`, on the premise that "Cloudflare
overwrites it, so unforgeable — prod is confirmed behind Cloudflare." Re-tested that premise
adversarially rather than accepting it:

- **From the internet the premise holds, and is stronger than stated.** `server: cloudflare` and a
  `cf-ray` on live responses; the zone resolves to Cloudflare IPs; and the origin is published
  through a **`cloudflared` tunnel**, so there is no public origin address to reach around the
  edge at all. Traefik's LoadBalancer addresses are RFC1918 (`192.168.2.52/.56/.57`).
- **From the LAN it does not hold.** The origin answers plaintext HTTP directly
  (`http://192.168.2.52/` with a `Host:` header → `200`) and accepts a client-supplied
  `CF-Connecting-IP` verbatim → `200`. Anyone with LAN or in-cluster network access can forge the
  client IP and defeat every IP-based control — login brute-force limiting, anonymous-report flood
  limiting, and article-view dedup.

This is **not a go-live blocker**: it requires network access that already implies a far larger
compromise. It is recorded because Session 46's "unforgeable" is true of the internet, not of the
origin, and the durable fix is to restrict the origin to the tunnel (or enforce a Cloudflare-only
allowlist at Traefik) rather than to rely on the header alone.

### 11.6b Confirming Sessions 45 and 46 are genuinely closed, not just claimed closed

Spot-checked independently against real production data and live artifacts, per this session's
scope. All held:

| Claim | Source | Independent check | Result |
|---|---|---|---|
| `answers_select` join-depth fix landed | S45 §9.1 | Read the live policy from the production schema | ✅ Uses `attempts.course_id` → `cohorts` → `cohort_teachers`; the `assessments` hop is gone. |
| Teacher org-scoped course creation shipped | S45 §9.3 | Query `permissions` in production | ✅ `courses.create.organization` present with its documented description. |
| Orphaned `Asset` row resolved | S45 §9.4 | Enumerate all 7 production assets and their references | ✅ `10d94d8d` (`control-plane-bootstrap-og.png`) is `status=deleted`, `deleted_at=2026-09-05`. A second orphan (`42914f8e`) is also already soft-deleted. **No unaccounted orphan exists.** |
| F1 (`X-Forwarded-For`) fixed and live | S46 | Deployed image digest + call-site sweep + Cloudflare fronting | ✅ Running image is the S46 merge commit; all 5 call sites use `resolveClientIp`; no raw XFF reads remain; Cloudflare confirmed in front. Qualified by §11.6a. |
| F2 (`jit=off`) fixed and live | S46 | Deploy run `34029642801` log + migration present in repo | ✅ Migration `20260906120000_disable_jit_deep_rls_policies` applied in that run. Not re-queried on live production (DB access blocked); the restore proves the mechanism works, and `pg-restore.sh` re-applies it — except in the aborted path of §11.2(b). |
| The one failing test is a known flake | S46 | Ran it in isolation | ✅ `notifications.test.ts` fails in the full run (fire-and-forget timing) and passes **33/33** alone. Not a regression. |

Full suite this session: **894 / 895 passing**, 66 of 67 files clean, the single failure being that
flake. `tsc --noEmit`: clean.

### 11.7 Sign-off by area — every portal, including Keen Africans

Read the caveat in §11.1 first: **no area below carries an authenticated live sign-off**, because
QA credentials are correctly withheld from agents. Each verdict states what it actually rests on.

| Area | Status | What it rests on |
|---|---|---|
| **Admin** | ✅ boundary-verified | All 14 protected routes (`/audit`, `/flags`, `/education/*`, `/certificates/*`, `/messages/*`, **`/keen-africans/*` moderation**) return 307→`/login` anonymously. Test suite green. Not exercised authenticated. |
| **Teacher** | ✅ boundary-verified | All 14 protected routes redirect anonymously, including `/assessments/*` (Session 31's P0 surface) and `/organization/*`. Not exercised authenticated — the `/assessments` P0 has not been re-driven through a real teacher session since Session 31. |
| **Student** | ✅ boundary-verified | All 14 protected routes redirect anonymously. Same caveat. |
| **Sponsor** | ✅ boundary-verified, one cosmetic defect | All 7 protected routes redirect anonymously. **`sponsor.keenafrica.com/` returns 404** — the only one of the five portals with no index page (`src/app/sponsor/page.tsx` absent); the other four redirect to `/login`. Low severity, real. |
| **Keen Africans — identity & auth** | ✅ boundary-verified | `/dashboard`, `/profile`, `/account`, `/account/delete`, `/security`, `/step-up`, `/notifications`, `/articles/new` **all** 307→`/login` anonymously. Public surfaces (`/`, `/latest`, `/search`, `/register`, `/login`, `/privacy`, `/terms`) all 200. |
| **Keen Africans — publishing** | ✅ | Published article renders publicly at its `/{username}/{slug}` (200); the draft is not publicly reachable. Production holds 2 articles (1 published, 1 draft), 1 profile. Audit trail confirmed firing (§11.6). |
| **Keen Africans — verification** | ⚠️ built, essentially unexercised | `keen_african_verifications` table present in the production schema; Session 46 proved server-side that self-granting `verified`, approving without `verification.review`, and rejected→verified replay are all blocked. But production holds **0 verification records** and the one profile is unverified — so the flow has no real production usage behind it. |
| **Keen Africans — moderation** | ⚠️ built, entirely unexercised | `reports` table present; admin queue routes exist and are gated. Production holds **0 reports, 0 comments, 0 follows**. Session 46's report-flood fix is live. No real moderation event has ever occurred. |
| **Keen Africans — discovery** | ✅ boundary-verified, thin | `/search` and `/latest` 200; FTS GIN indexes present on `profiles` and articles in the production schema. `/topics/technology` 404s — correct, no such topic exists in a dataset this small. |
| **Security / RLS** | ✅ | Session 46 closed, independently spot-checked (§11.6b). |
| **Disaster recovery** | ❌ **blocking** | §11.2, §11.3. |
| **Incident rollback** | ❌ **blocking** | §11.4. |

A fair reading of the Keen Africans rows: the surface is **built, gated correctly, and adversarially
tested by Session 46 — but almost entirely unused.** Its production dataset is 2 articles, 1
profile, and zero comments/follows/reports/verifications, all authored by the site owner. That is
not a defect; it is the honest state of a pre-launch product, and it means "verified" here means
"the boundaries hold," not "the workflows have proven themselves at any volume."

### 11.8 Named non-blocking limitations

Recorded explicitly rather than folded into any pass, per Session 30's own standard.

- **N1 — No encryption at rest, in two places.** `postgres01`'s ZFS pool is unencrypted (Session
  01). Backup dumps are additionally `-rw-r--r-- root:root` on unencrypted ext4 on this runner —
  readable by any local user. Bounded by what a dump exposes: all PII and emails, and bcrypt
  hashes (cost 12, strong). **Not** plaintext TOTP secrets (`totp_credentials.secret_ciphertext`
  is application-encrypted) and **not** recovery codes (`recovery_codes.code_hash` is hashed) —
  verified against the real schema.
- **N2 — Host-local secret exposure.** Production DB credentials for both `kf_portal_prod_app` and
  `kf_portal_prod_migrator` are in plaintext in `~/portal-db-setup-prod.sh`, mode `0775`. The
  `cloudflared` tunnel token is visible in the process command line to any local user. Documented
  only, per the site owner's decision this session; nothing was rotated or chmod'd. Both warrant
  rotation, and this host holds the dumps *and* a working `KUBECONFIG`, so a local compromise is a
  full compromise.
- **N3 — Origin reachable and header-trusting on the LAN.** §11.6a.
- **N4 — DMARC `p=none` / `sp=none`.** Unchanged since Session 30; aggregate reports still route to
  a personal Gmail address, not a team alias.
- **N5 — CSP is report-only, with `'unsafe-inline'` on `script-src`.** Unchanged.
- **N6 — Four product capabilities are switched off in production.** All 10 `feature_flags` rows
  are `enabled = false`, including **`messaging`, `certificates`, and `sponsor_reporting`** —
  each enforced server-side at the page level (`isFeatureEnabled` in the student, teacher and
  admin message/certificate routes). Launching today launches **without** messaging, certificates,
  or sponsor reporting. This may well be the intended staged rollout, but it is not stated
  anywhere, and Session 30's sign-off marked the Sponsor portal ✅ and the Teacher portal
  messaging-verified without noting that these surfaces are flag-dark in production. **A
  deliberate decision is needed on which flags flip at launch.**
- **N7 — `sponsor.keenafrica.com/` 404s.** §11.7.
- **N8 — Two legacy `storage_driver='local'` assets remain active with live attachments**
  (`certificate-KA-2026-2FB5355B6CA3.txt`, `qa_doc.txt`, both 2026-08-31). Carried over from
  Session 45, unchanged. Both are unreadable from whichever replica did not write them — the
  Session 32 failure mode. Both are QA-era artifacts and evaporate with Session 48's purge.
- **N9 — No backup contains the current migration state.** The newest dump (09:57 UTC) predates
  today's Session 46 deploy, so `_prisma_migrations` in it holds 57 of the repo's 58 migrations
  (missing `20260906120000_disable_jit_deep_rls_policies`). Benign — that migration only sets a
  database-level GUC, is idempotent, and `pg-restore.sh` re-applies the setting independently.
  Noted because it is the visible edge of §11.3: today's backup failed.
- **N10 — No offsite copy and no PITR/WAL archiving.** Recovery granularity is "as of the last
  good daily dump", and per §11.3 that is currently as much as four days.
- **N11 — Organization-scoped data still unexercised in production.** Production has an
  org-scoped course (Session 45's) but **0 org-scoped cohorts**, so Session 29's cross-org PII fix
  still cannot be exercised against real production rows; Session 46 re-proved it on a replica.
  Unchanged standing item since Session 21 — re-verify the day the first real org-scoped
  cohort + enrollment exists.
- **N12 — No authenticated production verification this session.** §11.1.

### Go / No-Go statement

> **NO-GO**, as of 2026-09-06.

The product is in better shape than this verdict sounds. Every portal's authorization boundary
holds under live anonymous probing, including all of Keen Africans; the suite is green against the
real RLS-enforcing role; Session 45's and Session 46's fixes are independently confirmed closed
rather than taken on trust; and both of Session 30's original NO-GO items (assessments, file
storage) remain genuinely fixed. **No product defect blocks launch.**

What blocks launch is everything around it. Three of the four blockers are in disaster recovery
and incident response — the parts of a system that are only ever tested by testing them, and that
had not been. The first genuine restore of real production data, performed today, failed. The
backup that was supposed to prove this every night has been failing or not running for seven of
the last eleven days. The rollback tool tells an operator it is safe to do something that has been
unsafe since Session 31.

**The blockers, and exactly what flips each to GO:**

1. **Disaster recovery is broken (§11.2).** → Fix all three legs and re-run today's drill green:
   (a) make role/grant/default-privilege reconstruction part of the restore — either emit them
   from `pg-restore.sh` or add them to the runbook as an explicit, tested step; (b) stop
   `pg-restore.sh` aborting on `pg_restore`'s ignorable-error exit so ANALYZE and `jit=off` always
   run (capture the status, decide on it, then continue); (c) reconcile the dump's tooling version
   with the server's — either pin `PG_IMAGE` to `postgres:14-alpine` to match production, or
   upgrade production and say so. Then prove it: restore today's dump into a **fresh PG 14.24
   database** and have the **`kf_portal_prod_app` role successfully read a table**. That single
   assertion is the acceptance test, and it is the one that has never been run.
2. **Backups are not reliably running (§11.3).** → Remove the manual-approval gate for the
   scheduled backup (or move it to a job that does not need `environment: production` for a read
   -only dump), fix the `pg_isready` race in the verify step (poll the real server, e.g.
   `pg_isready` against the mapped TCP port, or wait for the "ready to accept connections" log
   line on the *second* startup), and route failures somewhere a human sees. Flips to GO after
   **seven consecutive unattended daily runs succeed**, with seven dumps on disk to show for it.
3. **The rollback plan is stale (§11.4).** → Correct `rollback-portal.yml`'s header claim and
   `docs/PRODUCTION_HARDENING.md`'s runbook to state the real floor (currently Session 36), and
   add the two `NOT NULL` migrations to a maintained compatibility note so the floor moves
   forward deliberately rather than silently. Cheap; it is documentation and one comment. Flips to
   GO once the runbook tells the truth.
4. **QA accounts can authenticate against production (§11.5).** → Cleared by **Session 48**, which
   purges all production data and creates one fresh super-admin. **Sequencing note, deliberately
   explicit:** this blocker is cleared *by* the launch step rather than before it, so it must not
   be read as gating Session 48 — that would deadlock (Session 48 needs GO; GO needs the purge).
   Blockers 1–3 are the real gate. Once they close, this document should be amended to GO **for
   the purpose of authorizing Session 48**, and blocker 4 closes as Session 48 executes.

**What a follow-up session should be scoped from this:** blockers 1–3 are one coherent piece of
work — backup, restore and rollback are the same operational surface, all three are small, and all
three are provable by a single re-run of §11.2's drill plus a week of clean backup runs. Scope
them as one session (49). Do **not** scope it to touch the product; nothing in the product needs
changing to reach GO.

## 12. Session 49 — Disaster Recovery Hardening (2026-09-06)

> **The Go/No-Go verdict in §11 is NOT amended by this section.** Two of §11's three
> disaster-recovery blockers are closed with live evidence below. The third (backups running
> unattended) cannot be closed on the day its fix lands — §11 defines it as *seven consecutive
> unattended daily runs succeeding, with seven dumps on disk*. **The clock started 2026-09-06**,
> when this session merged as `70414ac`; the first unattended run under the fixed workflow is
> 02:17 UTC on **2026-09-07**. The earliest date anyone can honestly amend the verdict on that
> item is **2026-09-13**, and only after checking the real run history. Anything sooner is
> rounding down.

Scope: `scripts/backup/pg-backup.sh`, `scripts/backup/pg-restore.sh`,
`scripts/backup/test-restore-drill.sh`, `.github/workflows/backup-portal-db.yml`,
`.github/workflows/rollback-portal.yml`, and the two runbooks. **No product code, UI, schema,
migration, permission or business logic was touched** — §11 was explicit that nothing in the
product blocks launch, and nothing in the product was changed to reach these results.

### 12.1 BLOCKER 1 (§11.2) — CLOSED. The acceptance test passes.

§11.2's acceptance test, verbatim: *restore today's real production dump into a fresh PostgreSQL
14.24 database and have the `kf_portal_prod_app` role successfully read a table.* It had never
passed. It passes now. Full transcript, run 2026-09-06 against
`portal-20260906T095712Z.dump` — the same dump §11 measured against, on a disposable
`postgres:14-alpine` server (`PostgreSQL 14.24 on x86_64-pc-linux-musl`), prepared with the
runbook's step 2 and nothing else:

```
Fresh database, prepared with runbook step 2 and nothing else:
  public tables: 0
  grants for kf_portal_prod_app: 0

$ RESTORE_CONFIRM=yes ./scripts/backup/pg-restore.sh \
    /home/keen/backups/portal-db/portal-20260906T095712Z.dump \
    "postgresql://kf_portal_prod_migrator@127.0.0.1:55614/dr_fresh"
==> Checking the target server's version
    target server major: 14, client: 14.24, expected: 14
!! LEGACY ARCHIVE: portal-20260906T095712Z.dump is archive format 1.15 ...
!! Reading it with postgres:16-alpine instead; the target server is still
!! PostgreSQL 14, so the restored database is unaffected.
==> Restoring ... into target (schema is dropped/recreated via --clean --if-exists)
pg_restore: error: could not execute query: ERROR:  must be owner of extension pgcrypto
  ... (4 of these) ...
pg_restore: warning: errors ignored on restore: 4
==> pg_restore exited 1 with 4 ignorable error(s), all matching
    the expected extension-ownership pattern (/must be owner of extension/).
    Continuing to the post-restore steps.
==> Re-applying kf_portal_prod_app's grants (privileges are not carried in a dump)
 grants_for_app_role
---------------------
                 244
==> Running ANALYZE on the restored database (statistics are not included in a dump)
==> Setting jit=off on the restored database (a database-level setting is not carried in a dump)
==> Restore command completed.

pg-restore.sh exit code: 0

--- THE ASSERTION THAT HAD NEVER PASSED --------------------------
$ psql -d "postgresql://kf_portal_prod_app@127.0.0.1:55614/dr_fresh" -Atc "select count(*) from users"
0
psql exit code: 0   (0 rows is correct — the app role is RLS-scoped with no session context)
------------------------------------------------------------------
```

Every measurement §11.2 recorded as broken, re-measured on that restore:

| Measurement | §11.2 (broken) | Now |
|---|---|---|
| Grants for `kf_portal_prod_app` | **0** (`permission denied for table users`) | **244** — the same count production runs on (61 tables × 4 DML privileges) |
| `pg-restore.sh` exit code | **1**, before its own last two steps | **0** |
| Never-analyzed tables | **16 of 61** | **0 of 61** |
| `show jit` | **on** | **off** |
| `pg_db_role_setting` rows for the DB | **0** | **1** |
| RLS policies restored | — | **196**, matching production |
| Users restored | — | **13**, matching §11.5's production count |

**(a) Missing grants — fixed in `pg-restore.sh`, not left to the runbook.** The script now
reconstructs exactly what `~/portal-db-setup-prod.sh` grants — `USAGE` on schema `public`,
`SELECT/INSERT/UPDATE/DELETE` on all tables, and `ALTER DEFAULT PRIVILEGES FOR ROLE <the
connecting role>` for future tables — then verifies the result and **fails loudly if the app role
does not exist or ends up with no grants**. Roles themselves are cluster-level and can never be in
a dump, so the runbook now makes creating them an explicit part of step 2, and the script refuses
to finish without them rather than leaving a silently-unusable database. `RESTORE_APP_ROLE=none`
is the documented opt-out for an in-place restore that already has its privileges.

**(b) Aborting before ANALYZE and `jit=off` — fixed, and more strictly than §11.2 asked.** The
script captures `pg_restore`'s exit status and then **classifies the errors** rather than trusting
the presence of an "errors ignored on restore: N" line — `pg_restore` prints that same summary for
real failures too, since it continues past errors unless `--exit-on-error` is given. Only errors
matching `must be owner of extension` (configurable via `RESTORE_IGNORABLE_ERROR_REGEX`) are
treated as ignorable. Anything else prints a loud block naming the unclassified errors, **still
runs the post-restore steps** (skipping them is the defect being fixed), and exits non-zero at the
end. Verified both ways: the ignorable path above exits 0, and a deliberately-broken restore
(`REVOKE CREATE ON SCHEMA public`) produced 705 errors, was correctly refused as unclassified, and
exited non-zero.

**(c) Tooling version mismatch — pinned and enforced at both ends.** `EXPECTED_PG_MAJOR` (default
`14`) now drives `PG_IMAGE` in both scripts. `pg-backup.sh` queries the live server's
`server_version_num` and **refuses to take a backup** if either the client image or the server
disagrees with it; `pg-restore.sh` refuses to restore on the same mismatch. Proven: a dump taken
with the pinned tooling is `Dump Version: 1.14-0`, `Dumped by pg_dump version: 14.24`, and
PostgreSQL 14's own `pg_restore --list` reads it (exit 0) — the exact command that failed in
§11.2(c).

One consequence §11.2 did not anticipate, handled deliberately: **the seven dumps already on disk
are format 1.15 and PostgreSQL 14 cannot read them.** Retention keeps monthly dumps for six
months, so refusing them outright would have traded one broken restore path for another. Instead
`pg-restore.sh` detects the case, prints a `LEGACY ARCHIVE` banner naming exactly what is
happening, reads the archive with a container new enough for it, and still restores into the
PostgreSQL 14 target. That is the path the transcript above took, and it is why today's real dump
could be used for the acceptance test at all.

**(d) The daily verification can now catch all of it.** `backup-portal-db.yml` restores into
`postgres:14-alpine`, creates production's role names, restores **as the migrator role**, and
asserts `kf_portal_prod_app` can read a table plus that its grant count is non-zero. Run end-to-end
against the real production dump on the runner host: `users=13 policies=196 app_role_grants=244
app_role_read=0`, exit 0. The old superuser-on-PG16 check could not have failed on any of (a), (b)
or (c); this one fails on all three.

**Negative tests** (the tooling must refuse, not just succeed) — all five verified live:

| Case | Result |
|---|---|
| `PG_IMAGE` disagrees with `EXPECTED_PG_MAJOR` | Refused, exit 1 |
| Target server major disagrees with `EXPECTED_PG_MAJOR` | Refused, exit 1 |
| App role absent from the target cluster | Refused, exit non-zero, with the remedy in the message |
| Truncated/corrupt archive | Refused, exit 1, with the underlying `pg_restore` errors |
| `pg_restore` errors that are not the known-benign ones | Loud block, post-restore steps still run, exit non-zero |

`test-restore-drill.sh` was rewritten to match: production's major version, production's role
names, restored as the migrator role, and assertions on the marker row, RLS policies, **the app
role's read**, the grant count, statistics and `jit=off`. It deliberately reproduces the
ignorable-error condition (extensions created by the superuser) so the §11.2(b) path is exercised
on every run. **DRILL PASSED**: 196 policies, 244 grants, 0 never-analyzed tables, `jit=off`
applied, on PostgreSQL 14. The old drill restored as the superuser — which is why it passed for
months against a procedure that produced a database the portal could not read.

### 12.2 BLOCKER 2 (§11.3) — FIX LANDED. Seven-day clock starts 2026-09-06. **NOT YET MET.**

All three causes are fixed. **None of that is the acceptance criterion**, which is seven
consecutive unattended daily successes with seven dumps on disk. As of this session there are
**zero** such days. Stated plainly so nobody reads a landed fix as a met criterion.

- **The manual-approval gate is gone from the backup workflow** (`environment: production`
  removed). This was the cause of the four days with no backup at all. **The reason it was there
  was checked before removing it**, per §11.3's own instruction: `docs/BACKUP_RESTORE.md` recorded
  it only as "same manual-approval gate as deploys", i.e. uniformity, and the GitHub API confirms
  `PORTAL_DATABASE_URL_PROD` is a **repository** secret, not an environment secret — so nothing in
  this workflow ever depended on the environment for access. **The gate is untouched on
  `deploy-portal.yml` and `rollback-portal.yml`**, which is what §11.3 required.
- **The `pg_isready` race is gone.** The verify step now waits for a successful query over the
  container's **mapped TCP port**. The postgres image's temporary init server listens on a unix
  socket only, so it cannot answer a TCP query — the race is closed by construction rather than by
  a longer sleep. (The same fix is in `test-restore-drill.sh`, which had the same latent race.)
- **Failures are routed somewhere a human sees.** A failed run opens a GitHub issue titled
  "Portal DB backup failed", or comments on the existing open one so a week of failures is a single
  thread. This reuses GitHub — the channel this repo already relies on — rather than standing up
  the external alerting integration `PRODUCTION_HARDENING.md` correctly records as an open
  decision. It uses only the built-in `GITHUB_TOKEN` with `issues: write`.

**What the next session must actually check before amending this item** (do not accept a summary,
including this one):

```bash
gh run list --workflow=backup-portal-db.yml --limit 15
ls -lt /home/keen/backups/portal-db/*.dump | head -10
```

Seven consecutive dated successes on or after 2026-09-07, and seven dumps on disk with matching
dates. A run in `waiting` counts as a failure of this criterion, not a pending result. If it holds
on 2026-09-13 or later, this item flips to GO.

**Not verified this session, and it cannot be**: everything above was proven by executing the
workflow's own steps directly on the runner host against the real production dump, which proves
the logic, not the schedule. No unattended run has happened yet.

> **The clock's precondition is met — recorded after the fact, not predicted.** Session 49 merged
> to `main` as **`70414ac`** on **2026-09-06** (PR #96, which also carried Session 47's
> previously-unmerged `ec4a40f`). GitHub Actions runs scheduled workflows from the default branch,
> so this is the event that starts the count. Verified on `main` after the merge: the backup
> workflow has **no `environment:` key**, while `deploy-portal.yml` and `rollback-portal.yml` both
> still carry `environment: production` — the deploy approval gates were not weakened, only the
> backup workflow's unnecessary dependence on one.
>
> **First unattended run under the fixed workflow: 02:17 UTC on 2026-09-07. Seventh consecutive
> success, if every one of them succeeds: 2026-09-13. That is the earliest date this item can be
> re-judged.** Still check the real run history with the two commands above rather than counting
> forward from these dates — **a run sitting in `waiting` is a failure of this criterion, not a
> pending result**, and one failure anywhere in the window restarts it.
>
> The merge also triggered `deploy-portal.yml` (run `34033482382`, success), because it touched
> `portal/**`. That rebuilt **identical product source** — production now runs
> `ghcr.io/bambocharles/keenafrica-portal:70414ac…`, both replicas `1/1 Running`. No product
> change shipped with this session; the deploy is recorded only so the image tag on the cluster
> can be accounted for.

### 12.3 BLOCKER 3 (§11.4) — CLOSED.

§11.4's finding was independently re-derived rather than copied. `grep -rlE "SET NOT NULL|DROP
COLUMN|DROP TABLE|RENAME (COLUMN|TO)" prisma/migrations/` over all 58 migrations returns **exactly
the two migrations §11.4 named and nothing else** — no migration in this repo has ever dropped or
renamed anything. The satisfying code and the migration ship in the same commit in both cases,
confirmed with `git log -S`:

| Floor-setting commit | Session | Constraint | What breaks below it |
|---|---|---|---|
| `9871a03` | 36 | `articles.author_name SET NOT NULL` | Every article creation fails |
| `6b1c2b3` | 31 | `attempts.course_id SET NOT NULL` | Every new assessment attempt fails |

**The stated floor is now `9871a03` (Session 36)**, the later of the two, in
`rollback-portal.yml`'s header and in a new "Rollback compatibility floor" section of
`docs/PRODUCTION_HARDENING.md`. The old "true of every migration in this repo to date" claim is
gone from both, and from `PRODUCTION_HARDENING.md`'s migration-process paragraph.

Two things beyond the documentation fix §11.4 asked for:

- **The floor is enforced, not just written down.** `rollback-portal.yml` now checks the requested
  `image_tag` against `ROLLBACK_FLOOR_SHA` with `git merge-base --is-ancestor` and refuses a target
  below it, with an explicit `acknowledge_below_floor` checkbox as the deliberate override (an
  incident must never be *blocked* by this check, only slowed by one decision). Verified against
  real history: `ec4a40f`, `2d395a8`, `e2ee69b` and `9871a03` itself pass; `6b1c2b3` and `685296b`
  are refused; refusal is lifted by the acknowledgement; an unresolvable SHA warns and continues.
- **A maintained-note rule, with a re-derivation command.** Both places state that any future
  migration adding a constraint older code cannot satisfy must raise the floor **in the same PR**,
  and `PRODUCTION_HARDENING.md` carries the `grep` above so the list can be rebuilt from the repo
  rather than trusted. That is what stops this going stale again the way it did for six sessions.

One adjacent observation, recorded because it is the same shape and was not in §11.4: because
`deploy-portal.yml` migrates *before* swapping the image, each of those two migrations also made
writes to its table fail for the length of that rollout window (old image, new constraint). Seconds
to a minute on a pre-launch system with no traffic — noted in `PRODUCTION_HARDENING.md` as an
argument for expand/contract once there is real traffic to lose, not raised as a blocker.

### 12.4 Regression cover

No product code was touched, but the suite was re-run rather than assumed: **895/895 passing,
67/67 files**, `tsc --noEmit` clean. Session 47's single failure was the documented
fire-and-forget `notifications.test.ts` timing flake; it passed in this run, which makes it a
flake rather than something this session fixed.

### 12.5 What this session did NOT do

- **It did not amend the Go/No-Go verdict.** §11 stands as written. Blocker 2 needs calendar time,
  and blocker 4 (QA accounts, §11.5) was untouched and remains Session 48's.
- **It did not take a fresh production backup.** Direct connections to `keenafrica_portal_prod` are
  classifier-blocked in this sandbox, exactly as §11.1 documented; every result above is from the
  real dump already on disk. The first dump written by the pinned tooling will be tonight's
  scheduled run.
- **It did not dispatch either workflow against production.** Both were validated by executing
  their own steps on the runner host (backup verify) and against real git history (rollback floor
  guard). Dispatching the rollback workflow would redeploy production; dispatching the backup
  workflow requires the production credentials this session cannot use. (The merge did trigger
  `deploy-portal.yml` as a side effect of touching `portal/**` — see §12.2. That is a rebuild of
  unchanged product source, not a dispatch of either workflow this session edited.)
- **It did not touch product code.** No `src/`, no `prisma/`, no migration, no permission, no test
  outside `scripts/backup/`.

### 12.6 Standing limitations this session did not change

§11.8's N1 (no encryption at rest for dumps), N10 (no offsite copy, no PITR/WAL archiving) and N2
(host-local plaintext credentials) all still stand and are all still the right follow-ups. N10 in
particular is now the largest remaining DR gap: the restore path works, but every copy of the data
still lives on two hosts in one building. One addition of this session's own: **the role passwords
needed to reconnect the application to a restored database exist only on `postgres01` and in the
GitHub secret** — if `postgres01` is lost and the secret is unavailable, the dumps restore fine but
new roles and a new `PORTAL_DATABASE_URL_PROD` must be issued before the portal can serve from
them. Recorded in `docs/BACKUP_RESTORE.md`.

## Required next-session actions

> **Superseded in part by §11 (Session 47, 2026-09-06), then by §12 (Session 49, 2026-09-06).**
> Of §11's blockers 1–3, **1 and 3 are closed by §12 with live evidence; 2's fix has landed and is
> on a seven-day clock that started 2026-09-06** — the earliest honest re-check is 2026-09-13, and
> §12.2 names the two commands to run. Blocker 4 (QA accounts) is unchanged and belongs to Session
> 48. The items below are Session 30/45's originals, retained because several are still open and
> none were re-closed by Sessions 47 or 49.


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
