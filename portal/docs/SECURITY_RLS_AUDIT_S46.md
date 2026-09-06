# Session 46 — Full-Platform Security & RLS Audit

A Session-29-grade adversarial pass across the whole platform, focused on the
Keen Africans surface built since Session 29 (Sessions 30–44), plus completion
of Session 33's original RLS-depth audit over the entire current schema.

Methodology: crafted direct SQL/HTTP requests, never UI clicking. Every RLS
verdict was measured under the real non-superuser role (`portal_rls_test`
locally; `kf_portal_prod_app`/`portal_rls_test` on a **version- and
data-matched (PG 14.24) restore of the live production database**, dump
`portal-20260906T095712Z`), never the superuser dev connection, which silently
bypasses RLS. Live probes ran against real production
(`keenafricans.keenafrica.com`), non-destructively.

## Result

**Two findings. One live-exploitable (fixed); one latent structural fragility
(fixed durably). No finding remains open.**

- **F1 (P1, CONFIRMED live-exploitable, FIXED):** every IP-based control
  (login brute-force limit, anonymous-report flood limit, article-view dedup)
  keyed on the raw, client-spoofable `X-Forwarded-For` header. Rotating it
  bypassed all of them.
- **F2 (P2, latent, FIXED durably):** the schema's deep RLS policies cross
  Postgres's `jit_above_cost` at low, realistic row counts (as few as ~358),
  reproducing the Session 31 P0 mechanism. Fixed by disabling JIT at the
  database level (denormalization provably cannot apply — see F2).

Everything else attempted was correctly rejected server-side. Details below.

---

## Part A — Session 33's RLS-depth audit, completed over the whole schema

Tooling (rebuilt so the candidate list can never go stale again — the old
`explain-rls-policies.ts` hard-coded a list that predated every Keen Africans
table):

- `scripts/dev/rls-depth-audit.ts` — derives each policy's transitive
  RLS-table reference set straight from `pg_policies` + the `app_*` SECURITY
  DEFINER helpers, marking helper (bypass) edges distinctly from plain table
  references. Reports every policy's depth.
- `scripts/dev/explain-rls-policies.ts` — for every policy at depth ≥3, runs
  `EXPLAIN` (SELECT/UPDATE/DELETE) and `EXPLAIN (ANALYZE, BUFFERS)` under the
  real RLS role with an adversarial session context (a user id matching
  nothing, no permissions — forces every EXISTS branch to evaluate), and
  computes cost-per-row headroom against `jit_above_cost`.
- `scripts/dev/rls-jit-headroom.ts` — grows a disposable replica through
  realistic volumes to locate each policy's JIT-crossing point empirically.

**Enumeration:** 196 policies total; 60 of 61 tables have RLS (`_prisma_migrations`
is the sole exception — correct: it is migrator-only bookkeeping, no user data).
**52 policies have 3+ table reference depth.** INSERT policies (14 of the 52)
are excluded from the cost verdict and the exclusion is *proven, not asserted*:
a WITH CHECK is evaluated per row outside the plan tree (differential EXPLAIN:
the same source feeding an INSERT into the deepest WITH-CHECK table adds 0 to
plan cost), so it can never cross a plan-cost JIT threshold no matter how deep.

**Plan-cost verdict (measured on the production replica, RLS role):** at
production's actual data volume, **every one of the 52 is under `jit_above_cost`
today** (largest `assets_select` at 1,504). But cost-per-row is fixed by policy
depth and independent of the referenced tables' size (proven: growing
`resources` 2→500 moved `resources_select` 223→55,473 and left
`asset_attachments_select` unchanged at 1,034). So the real verdict is the
headroom — how many rows a query may scan before the policy JIT-compiles:

| policy | cmd | rows→JIT | policy | cmd | rows→JIT |
|---|---|---|---|---|---|
| asset_attachments_delete | DELETE | **358** | assessment_questions_delete | DELETE | 1,038 |
| assets_select | SELECT | **465** | assessment_versions_select | SELECT | 1,038 |
| asset_attachments_select | SELECT | **483** | assessments_update | UPDATE | 1,049 |
| organization_invitations_select | SELECT | **541** | questions_update | UPDATE | 1,058 |
| resources_delete | DELETE | 633 | assessment_questions_select | SELECT | 2,002 |
| lessons_update / modules_update | UPDATE | 635 | assessments_select | SELECT | 2,044 |
| assessment_questions_update | UPDATE | 688 | questions_select | SELECT | 2,077 |
| lesson_versions_select | SELECT | 893 | certificates_select | SELECT | 2,111 |
| courses_select | SELECT | 895 | lesson_progress_select | SELECT | 2,111 |
| resources_select | SELECT | 897 | cohorts_select | SELECT | 2,668 |
| lessons_select / modules_select | SELECT | 901 | users_select | SELECT | 7,395 |
| | | | enrollments_select / cohort_teachers_select | SELECT | 7,966 / 11,350 |

The headroom model was validated on an independent policy: `courses_select`
(predicted 895) stayed under threshold at 900 synthetic courses and crossed
between 900 and 1,000 — measured 98,983 → 109,981, JIT on at 1,000.

Above the threshold the behaviour is the documented P0: e.g. `assets` at 1,000
rows under the RLS role took **1,595 ms, JIT-compiling 4,717 functions** for a
query returning nothing (Session 31's P0 was 6.7 s / 2,148 functions; Session
45's `assets` landmine 15.4 s / 4,796). A single unfiltered `findMany` over any
of these tables — or ordinary data growth past the row counts above — steps on
it. (Today no app code path does: every `assets`/`asset_attachments` query is a
`findUnique` or an indexed/bounded filter — confirmed by grep — so this is a
landmine, not a live fire.)

### F2 fix — disable JIT at the database level (not denormalization)

Sessions 31/45 fixed `attempts_select`/`answers_select` by denormalizing
`course_id` and joining `cohorts` directly. **That pattern provably does not
transfer to the deepest remaining policies.** An asset's visibility is
*dynamic* — a `lesson_resource` is visible to whoever can currently see its
lesson's cohort, which changes as `cohort_teachers`/`enrollments` change — so
there is no stable column to denormalize onto `assets`/`asset_attachments`
without building a cache-invalidation system (a new pattern this session is
forbidden to introduce). Per-branch cost attribution confirmed the driver is
these dynamic-visibility EXISTS subqueries (the `lesson_resource` branch alone
contributes ~119 of `asset_attachments_select`'s ~207 cost/row).

The correct fix for deep, dynamic-visibility RLS on an OLTP workload with small
tables is to disable JIT — it never pays for itself here and only ever hurts.
`prisma/migrations/20260906120000_disable_jit_deep_rls_policies/migration.sql`
sets `jit = off` at the database level (`ALTER DATABASE current_database() SET
jit = off`, so it is correct in dev and prod without a hard-coded name). This
removes the entire class of risk for all 52 policies at once, with **provably
identical query results** — EXPLAIN plans are unchanged, only the compile step
is skipped.

**Proven on the replica:** `assets` at 1,000 rows went from 1,595 ms / 4,717
JIT functions → **20.7 ms / 0 functions**, identical rows. `asset_attachments`
likewise → 8.4 ms / 0. Regression test: `rls.integration.test.ts` asserts
`jit=off` on the DB and that a deep-policy scan produces no JIT section even
with `jit_above_cost` forced to 0. `scripts/backup/pg-restore.sh` re-applies
`jit=off` after a restore (a database-level setting is not carried in a dump —
same defense-in-depth reasoning as Session 45's ANALYZE step, so a DR restore
does not come up pathological).

---

## Part B — adversarial pass on the Keen Africans surface

Every attack was reproduced with a crafted request and confirmed rejected
server-side. Verification-model attacks were run under the real RLS role on the
production replica; auth/anon attacks were run live against production.

| # | Attack (crafted request) | Result |
|---|---|---|
| 1 | Plain `KEEN_AFRICAN` (articles.write) **reads** another author's draft article | ✅ Blocked — `articles_select` returns 0; published article returns 1 (control) |
| 2 | Same actor **updates** another author's draft (`UPDATE articles … RETURNING`) | ✅ Blocked — `articles_update` returns 0 rows; app-layer `requireArticleOwnerOrManage` also rejects |
| 3 | Same actor **deletes** another author's draft | ✅ Blocked — `articles` has no DELETE policy → default-deny, 0 rows |
| 4 | Unverified account **self-grants `verified`** (self-INSERT status='verified') | ✅ Blocked — `keen_african_verifications_self_connect` WITH CHECK allows only `linkedin_connected` → RLS violation |
| 4b | Self-INSERT allowed `linkedin_connected`, then **self-flip to `verified`** (UPDATE) | ✅ Blocked — `self_reconnect` WITH CHECK allows only `linkedin_connected` → RLS violation |
| 5 | Holder of `articles.manage` but not `verification.review` **approves** a verification | ✅ Blocked — `keen_african_verifications_review` requires `verification.review` → RLS violation |
| 6 | Rejected verification **resubmitted/replayed** to bypass review | ✅ Not a bypass — self-reconnect can only return status to `linkedin_connected` (re-enters the queue); reaching `verified` still needs a fresh reviewer approval. Direct `rejected → verified` self-flip is blocked (RLS violation) |
| 7 | Read another user's **private users-row PII** (name/email) as an outsider `KEEN_AFRICAN` | ✅ Blocked — `users_select` returns 0 |
| 8 | Read another user's **pending verification** row | ✅ Blocked — `keen_african_verifications_select` public branch is `status='verified'` only; pending returns 0 |
| 9 | Plain `KEEN_AFRICAN` reads the **moderation report queue** | ✅ Blocked — `reports_select` requires `articles.manage`/super_admin → 0 rows |
| 10 | **Anonymous** request to every protected mutation (all `(protected)` actions + comment/react/follow/delete) | ✅ Blocked — each action calls `auth()` and throws/redirects to `/login`; protected layout + middleware are defense-in-depth. Live: all protected routes 307→/login; crafted anon Server Action POST 404s |
| 11 | **Report-flood** past the rate limit via rotating `X-Forwarded-For` | ❌ **BYPASSED → F1 (fixed).** See below |
| 12 | **Badge spoof** — client input rendering a `Verified`/`Featured` badge | ✅ Not possible — `VerificationBadge` props are all server-derived: `verified` from `getVerifiedUserIds()` (DB `status='verified'`), `featured`/`editorialBadge` from DB columns set only via permissioned actions, `member` from `emailVerifiedAt`. No client-controlled path renders a badge |

### F1 (P1) — X-Forwarded-For spoofing defeats every IP-based control

**What.** `src/lib/auth.ts` (login), `src/lib/reports.ts` (anonymous report
flood), and `src/lib/articles.ts` (article-view dedup) all keyed on
`h.get("x-forwarded-for")` taken verbatim. Cloudflare builds that header as
`"<client-supplied>, <real-ip>"` and the app used the **whole string** as the
key, so an attacker who rotates the leftmost, client-supplied hop gets a fresh
key on every request.

**Confirmed live (non-destructively):** sending different `X-Forwarded-For`
values to a public article inflated its public view counter one spoofed IP at a
time (46 → 47, a repeat correctly deduped, then 48 with a new spoof). Confirmed
on the report flood through the **real `createReport()` code path** on the
replica: a fixed IP was correctly blocked after 8 (limit 8/hour/IP), while
**rotating the spoofed prefix let 30/30 anonymous reports through** — a
logged-out reporter has no per-account limit, so the IP limit was the only
guard on the moderation queue. The same root cause weakens the login per-IP
brute-force limit.

**Fix.** New `src/lib/client-ip.ts` `resolveClientIp(headers)`: prefer
`CF-Connecting-IP` (the one header Cloudflare *overwrites*, so a client cannot
forge it — production is confirmed behind Cloudflare), else fall back to the
**last (rightmost)** `X-Forwarded-For` hop (the entry our trusted edge
appended), never the leftmost. Fails safe (over-aggressive, never open) if
`CF-Connecting-IP` is absent. Applied at all five call sites (3 in `auth.ts`,
report action, view recorder). Regression tests: `client-ip.test.ts` (resolver
is stable under a rotating spoofed prefix, never returns the leftmost hop) and
`reports.test.ts` (the rotating-prefix flood now trips the limit through
`resolveClientIp`).

---

## Part C — previously-accepted risk boundaries

- **Session 29 cross-org PII fix (`users_select`).** The boundary condition
  moved: production now holds a real **organization-scoped course** (Session
  45's teacher-created `09037e48…`, `scope=organization`, draft) — so "no
  org-scoped course exists" is no longer true. **But the leak's precondition
  still does not exist:** the vector needs a stale (non-active) member holding
  an enrollment/cohort_teacher row on an **org-scoped cohort**, and production
  has **0 org-scoped cohorts** (the one cohort is platform-scoped; teachers
  cannot create org cohorts — Session 45's documented "created, not yet
  teachable" state). The fix itself is intact (6 `app_cohort_organization_id`
  guards across the cohort-relationship branches) and was **re-proven on the
  replica** by constructing the exact stale-membership shape: an attacker
  removed from Org A but holding a real `cohort_teachers` row on an Org-A cohort
  reads the victim's PII → **0 rows**; the active Org-A teacher control → 1 row.
  *When the first real org-scoped cohort with enrollments exists in production,
  re-run this against real production data (not just the replica).*
- **Suspension blocks every portal, including Keen Africans.** Enforced
  centrally in the shared Auth.js `jwt` callback: `resolveSessionAuthz()`
  returns null for a suspended/deleted/revoked account, the callback returns
  null (invalidating the session), and the `keenafricans/(protected)` layout —
  like every portal — then redirects to `/login`. Host-independent; inherits
  Session 29's live proof (items 7/8) and Session 41's platform-wide
  confirmation. Verified in code against the Keen Africans layout.

## Regression sweep (Session 29 attacks vs Org/Sponsor/Education)

The full RLS integration suite (`*-rls.integration.test.ts` for education,
organization-aware education, sponsor, assessments, messaging, certificates,
assets, student-workspace, teacher-cohort, profiles, verification, follows,
reports, comments/reactions, article-views, notifications, progress) was run
against the real `portal_rls_test` role: **895/895 passing** (886 baseline + 9
new). Nothing regressed across Sessions 30–45. One notification test is a known
fire-and-forget timing flake (passes in isolation; Session 45 documented the
class) — not a regression.

## The `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` item (from Session 45's handoff)

**Not a security finding; Session 45's premise was factually wrong and is
corrected here.** Session 45 said the codebase uses only module-level
`"use server"` files and so has "nothing to encrypt across instances." In fact
there are **22 inline `"use server"` closures** (login/register/reset-password
pages and protected layouts). However: none bind sensitive closure variables
(they read from `formData` and use static redirect targets), and the two
production replicas run the **same image**, so they share the same build-time
encryption key at steady state. The only exposure is a transient
"Failed to find Server Action" error during a **rolling deploy** when old and
new pods serve simultaneously — an availability/UX blip, not a security hole,
and not a tampering risk (the key is build-secret regardless). Setting
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to a stable secret would remove the
deploy-window blip; recommended as deploy hygiene, not required.

## Changes

- **Migration:** `20260906120000_disable_jit_deep_rls_policies` — `jit=off` at
  the database level (F2 fix).
- **Code:** `src/lib/client-ip.ts` (new, F1 fix) + 5 call sites updated
  (`auth.ts`, `keenafricans/actions.ts`,
  `keenafricans/[username]/[slug]/page.tsx`).
- **Scripts:** `scripts/dev/rls-depth-audit.ts` (new),
  `scripts/dev/rls-jit-headroom.ts` (new), `scripts/dev/explain-rls-policies.ts`
  (rewritten — pg_policies-derived candidates, UPDATE/DELETE coverage, headroom
  verdict), `scripts/backup/pg-restore.sh` (re-apply `jit=off` after restore).
- **Tests:** `src/lib/client-ip.test.ts` (6), `reports.test.ts` (+1 rotating-XFF
  flood), `rls.integration.test.ts` (+2 JIT-off). 895/895; `tsc` clean; build
  clean.

## Open findings at handoff

**None.** F1 fixed + tested + live-confirmed as the exploit vector; F2 fixed
durably + tested + proven identical. Both fixes are **implemented and tested
but NOT yet deployed to production** — deploying is a production change awaiting
the site owner's go-ahead (see status handoff). Neither is a blocker to
Session 47/48 as *code*; the F1 exploit remains live in production until the
fix deploys, so **deploy is the one required next action**.
