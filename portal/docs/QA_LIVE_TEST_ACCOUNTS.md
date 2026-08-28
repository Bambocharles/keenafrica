# Live Integration QA Test Accounts (Session 22)

Real, controlled QA accounts used to exercise the actual production
authentication, email delivery, and organization-onboarding paths built in
Sessions 18–21 — against a real mailbox, real Google OAuth, and real
transactional email, not console-logged stubs. **Additive to, and
completely separate from, the synthetic demo dataset** (`testing/demo-
data.md`, `prisma/seed/tasks/demo/*`, Session 15) — that dataset was not
touched by this session and remains the canonical dev/CI seed universe.

## Why these accounts are safe to distinguish from real users

- Every email is a Gmail **plus-address** alias under one real inbox
  (`adebiyibanbo+qa.<role>@gmail.com`) — mechanically greppable, never a
  bare/plausible-looking address.
- Every account's `name` is prefixed `QA ` and suffixed `(non-production
  test account)`.
- The org is named `QA Test Org (Session 22)` (slug `qa-test-org-
  session-22`), not a plausible real organization name.

No production admin should mistake any of these for a real user/org at a
glance.

## Accounts

All in **production** (`keen-prod` — this is the only live environment for
the portal; see `docs/ENVIRONMENT.md`'s "Environments" section on why
staging doesn't exist here). No accounts were seeded directly — every one
was created through the real, live product surface (self-service
registration, or the admin console's user-creation action), exactly as a
real user/admin would.

| Role | Mailbox | Created via | Org membership |
|---|---|---|---|
| SUPER_ADMIN | `adebiyibanbo+qa.superadmin@gmail.com` | `seed-portal.yml` bootstrap (workflow_dispatch, keyed by email — additive, never overwrites an existing account's password) | — |
| ADMIN | `adebiyibanbo+qa.admin@gmail.com` | Admin console `/users` → "New user" (by the QA super admin) | — |
| TROUBLESHOOTER | `adebiyibanbo+qa.troubleshooter@gmail.com` | Admin console `/users` → "New user" | — |
| TEACHER | `adebiyibanbo+qa.teacher@gmail.com` | Public self-service registration at `teacher.keenafrica.com/register` | `org_admin` of QA Test Org (created it via `/onboarding`) |
| STUDENT | `adebiyibanbo+qa.student@gmail.com` | Public self-service registration at `student.keenafrica.com/register` | `org_member` of QA Test Org (invited by the QA teacher via real email, accepted) |
| SPONSOR_ADMIN | `adebiyibanbo+qa.sponsoradmin@gmail.com` | Admin console `/users` → "New user" | — |
| SPONSOR_USER | `adebiyibanbo+qa.sponsoruser@gmail.com` | Admin console `/users` → "New user" | — |

QA organization: **QA Test Org (Session 22)**, slug `qa-test-org-
session-22`, id `2f440a07-f5fa-4b7a-98fe-1597abcbbb56`, type `other`,
created live through Session 18's real onboarding flow (not seeded).

## Where credentials live (never in this repo, git history, seed scripts, or any Claude prompt)

- **SUPER_ADMIN**: password chosen and typed directly by the site owner via
  `gh secret set SUPER_ADMIN_PASSWORD --env production` (interactive
  prompt — never echoed, never seen by the assisting agent). Lives only in
  the `production` GitHub Environment secret and the user's own memory/
  password manager.
- **The other six** (ADMIN, TROUBLESHOOTER, TEACHER, STUDENT,
  SPONSOR_ADMIN, SPONSOR_USER): passwords were machine-generated and are
  stored **only** in a dedicated k8s Secret, `portal-qa-accounts` in the
  `keen-prod` namespace. This secret is **not** wired into the portal
  Deployment's `envFrom` (unlike `portal-secrets`) — it is a credential
  vault only, following the same "actual values live in a k8s Secret,
  populated out-of-band" convention `docs/ENVIRONMENT.md` already
  documents for application secrets. Access requires `kubectl` cluster
  access to `keen-prod`, same trust boundary as every other production
  secret.
- No password for any of these seven accounts has ever been written to a
  file in this repository, a commit, a seed script, or a markdown/prompt
  file. Temporary passwords typed into the admin console's "New user" form
  by the site owner were immediately superseded by a real password-reset-
  via-email round trip performed end-to-end before this document was
  written, so those initial values are no longer valid.

## What was verified (real HTTP against production, real email read back from Gmail)

For all seven accounts:
- Fresh password login (`/login`) — confirmed for all seven (six verified
  directly by the agent; SUPER_ADMIN's login was verified by the site
  owner, since the agent does not and should not know that password).
- Password reset via **real** email — triggered, delivered email located
  and read (subject/sender/token confirmed), token redeemed, new password
  set, fresh login with the new password confirmed. Done for all six
  non-super-admin accounts. (TEACHER has no *self-service* "forgot
  password" request page — see Known limitations — so its reset was
  admin-triggered from `/users/[id]`, same as the four admin-console-
  created accounts; STUDENT used its own self-service "Send myself a
  password reset link" button on `/security`.)
- MFA (TOTP) enrollment — done for TEACHER and STUDENT: real RFC 6238 code
  computed locally from the enrollment secret and confirmed. Not repeated
  for the other five roles (mechanism is shared/role-agnostic code, already
  proven twice); not attempted for SUPER_ADMIN (agent has no session for
  that account).
- Role assignment for the four admin-console-created accounts was
  independently confirmed via `/users` search (each shows exactly the one
  role requested — ADMIN, TROUBLESHOOTER, SPONSOR_ADMIN, SPONSOR_USER
  respectively), not just assumed from what was typed into the form.

QA organization / onboarding path:
- TEACHER registered → created "QA Test Org (Session 22)" via
  `/onboarding` → became `org_admin`.
- TEACHER invited STUDENT's email from `/organization/[id]` → **real
  invitation email confirmed delivered** to Gmail from
  `noreply@keenafrica.com`, subject "You're invited to join QA Test Org
  (Session 22) on Keen Africa".
- STUDENT accepted the invitation from `/organization` → membership now
  `org_member` / Active.

## A real, pre-existing production bug found and fixed along the way

Google sign-in was fully broken in production before this session — not a
QA-account issue, a real infrastructure gap that would have blocked every
real user too:

1. `portal-secrets`' `AUTH_URL=https://admin.keenafrica.com` was
   overriding Next-Auth's per-subdomain URL construction, making every
   subdomain's OAuth `redirect_uri` resolve to `admin.keenafrica.com`.
   `AUTH_URL` is undocumented anywhere in this repo and unreferenced by the
   k8s manifest — removed.
2. With that removed, the deeper cause surfaced: this domain sits behind a
   **Cloudflare Tunnel** (`terraform/main.tf`'s `cloudflare_record.site`,
   `cfargotunnel.com`), with `cloudflared` running as a host-level systemd
   service on `keenafrica-infra` (the k3s control-plane node) — not a
   cluster pod. Traefik (`kube-system/traefik` HelmChartConfig) had no
   `forwardedHeaders.trustedIPs` configured at all, so it never trusted the
   `X-Forwarded-Proto: https` header `cloudflared` was sending and
   overwrote it with its own literal (plain-HTTP) connection info —
   producing `redirect_uri=http://...` for every OAuth attempt, which
   Google rejects outright (`redirect_uri_mismatch`) since the registered
   URIs are `https://`.
3. Fixed by adding `ports.web.forwardedHeaders.trustedIPs` to the Traefik
   HelmChartConfig: Cloudflare's published public ranges plus this
   cluster's own private ranges (`192.168.2.0/24` node subnet,
   `10.42.0.0/16` pod CIDR, `127.0.0.1/32`) — the private ranges are needed
   specifically because `cloudflared` connects to Traefik from this
   cluster's own private network, not from Cloudflare's public edge IPs
   directly. Trusting them is safe: none of that range is reachable from
   the public internet, and the real security boundary (the Tunnel's own
   authentication) is unaffected either way.
4. This is **cluster-wide infrastructure**, not portal application code —
   it affects the `site` project too, not just the portal. Flagged here
   because it was found and fixed as a direct dependency of this session's
   own acceptance criteria, not because Session 22 owns Traefik/Cloudflare
   configuration going forward.

Verified after the fix: the real Server-Action-driven "Continue with
Google" flow (not a hand-crafted route-handler request — see Known
limitations below on why that distinction mattered) now produces the
correct `https://<subdomain>.keenafrica.com/auth/callback/google` on all
four subdomains (admin/teacher/student/sponsor).

Also found in the process and worth a permanent secret-hygiene note: two
earlier attempts to set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` via a
malformed `kubectl patch` put the literal credential values into the
Secret's **key names** instead of values — Kubernetes only base64-hides
values, not keys, so both were cleartext-visible via `kubectl get secret
-o yaml` the whole time. The client secret was rotated in Google Cloud
Console before the corrected value was set.

## Known limitations

- **Google sign-in's actual consent-screen round trip was not completed
  end-to-end.** The redirect construction (client_id, correct https
  redirect_uri per subdomain, PKCE challenge) is proven correct via the
  real Server Action flow, but actually completing a Google login requires
  a real browser and a real Google account authorizing the consent screen
  — not something this agent can drive headlessly. Same limitation
  Session 19 itself already flagged for the identical reason. If a browser
  automation tool is available in a future session, this is the one
  remaining gap to close.
- **TEACHER has no self-service "forgot password" request page** — only
  STUDENT's profile has a "Send myself a password reset link" button (this
  predates Session 22; confirmed by reading `src/lib/password-reset.ts`'s
  callers). `admin`/`sponsor` roles have no public forgot-password page at
  all either (by design — no public path to those roles, matching Session
  18's "Must NOT"). All are still reachable via admin-triggered reset from
  `/users/[id]`, which was used and verified for all of them.
- **Only one MFA factor (TOTP) was exercised**, and only for two of the
  seven roles (see above) — not because of a defect, but because the
  mechanism is shared, role-agnostic code already proven twice, and
  `MFA_REQUIRED_ROLES` (Session 20) does not force MFA at login for
  TEACHER/STUDENT, so there was nothing further to observe by repeating it
  five more times. Recovery codes were generated and the reveal page
  confirmed present, but a recovery-code login was not separately
  exercised.
- **Role-permission boundaries between ADMIN/TROUBLESHOOTER and between
  SPONSOR_ADMIN/SPONSOR_USER were not exhaustively re-tested** beyond
  confirming each account holds exactly the one role requested and can log
  in on the correct subdomain — this session verified account existence
  and authentication, not a full re-run of every permission-boundary test
  already covered by each owning session's own test suite.

## Removing or rotating these accounts later

1. **Suspend or delete** each of the seven accounts from the admin
   console's `/users/[id]` page (site owner or another real ADMIN/
   SUPER_ADMIN — the QA accounts themselves should not be used to remove
   each other).
2. **Delete the QA organization** — `QA Test Org (Session 22)` — via the
   admin console's organization management (`organizations.manage`,
   Session 17).
3. **Delete the credential vault**:
   `kubectl -n keen-prod delete secret portal-qa-accounts`
4. **Remove the SUPER_ADMIN bootstrap secrets** from the `production`
   GitHub Environment (`SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD`/
   `SUPER_ADMIN_NAME`) if they are not being kept for a legitimate future
   re-run of `seed-portal.yml` for a *different* purpose — note that
   re-running that workflow with different values only ever affects the
   one account keyed to whatever email is set at the time; it will not
   touch this QA super-admin account unless the email is reused.
5. To **rotate** rather than remove: use the same admin-triggered
   "generate password reset link" (or STUDENT's self-service one) real-
   email flow used throughout this session — the mailbox owner reads the
   real email and redeems it, no code or seed changes needed either way.
