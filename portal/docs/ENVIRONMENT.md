# Environments, configuration, and secrets

## Environments

- **Local development** — developer's own Postgres (e.g. `docker run
  postgres:16-alpine`, or `docker-compose` if you add one), `npm run dev`.
  `/etc/hosts` entries + `ROOT_DOMAIN=portal.local` exercise subdomain
  routing without touching real DNS (see README).
- **Production** — `keen-prod` k8s namespace, deployed by
  `.github/workflows/deploy-portal.yml` on push to `main` (paths:
  `portal/**`), gated by the `production` GitHub Environment's manual
  approval.
- **Staging** — does **not** currently exist for the portal. It was
  provisioned, verified end-to-end, and then deliberately retired to free
  resources on `keenafrica-infra` before this repo's Phase 1 cutover (see
  `portal/README.md` and `deploy-portal.yml`'s own comment). This is an
  intentional prior infrastructure decision, not an oversight — re-adding a
  staging portal environment (a second DB, a second k8s ingress
  host/namespace routing rule, DNS/tunnel wiring) is an infra-cost decision
  outside this session's scope. See the Session 01 handoff for the explicit
  BLOCKED note.

Demo/test accounts and data belong only to local development today. There
is nowhere else appropriate to put them until a staging environment exists
again — see `prisma/seed/tasks/demo.ts` and its `ALLOW_DEMO_SEED` guard,
which exists specifically to keep synthetic data out of production even in
that gap.

## Environment variables

None of the values below are secrets themselves — this table documents
names and purpose only; actual values live in `portal-secrets` (k8s Secret,
referenced via `envFrom` in `k8s/portal-prod.yaml`) and in GitHub Actions
repo/environment secrets. Never commit real values.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Prod uses the `kf_portal_prod_app` role (RLS-scoped, no `BYPASSRLS`); migrations/backups use `kf_portal_prod_migrator` (table owner, legitimately bypasses RLS) — see `README.md` and `docs/BACKUP_RESTORE.md`. |
| `AUTH_SECRET` | yes | Auth.js JWT signing secret. Generate with `npx auth secret` or `openssl rand -base64 32`. Rotating it invalidates all sessions. |
| `ROOT_DOMAIN` | no (defaults `keenafrica.com`) | Base domain `src/middleware.ts` strips to resolve the tenant subdomain. Set to `portal.local` for local dev. |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` / `SUPER_ADMIN_NAME` | only when running `npm run seed` | Super-admin bootstrap — see `prisma/seed/tasks/super-admin.ts`. Locally, pass inline on the command that runs the seed, never in a persisted config. In production, these are `production`-environment GitHub Actions secrets consumed by `../.github/workflows/seed-portal.yml` (manual `workflow_dispatch` only — `deploy-portal.yml` never runs the seed automatically). The task never overwrites the password of an account that already exists, so these secrets are safe to leave configured and re-run any time new seed data (e.g. roles/permissions) needs picking up. |
| `FEATURE_FLAG_OVERRIDES` | no | Local-dev/test-only JSON override for feature flags (see `docs/FEATURE_FLAGS.md`). Do not set in staging/production. |
| `ALLOW_DEMO_SEED` | no | Must be `true` to allow `npm run seed:demo` to run its demo-kind tasks. See `docs/SEED_FRAMEWORK.md`. |
| `PORTAL_DATABASE_URL_PROD` | CI only | GitHub Actions secret — the migrator connection string used by `deploy-portal.yml` and `backup-portal-db.yml`. Never exposed to the running application. |
| `RLS_TEST_DATABASE_URL` | no (local dev only) | Connection string for the non-superuser `portal_rls_test` role (`scripts/dev/create-rls-test-role.sql`) — enables `src/lib/rls.integration.test.ts`, which verifies RLS policies are actually enforced by Postgres rather than bypassed by the superuser connection the default `DATABASE_URL` uses locally. See `docs/IDENTITY_SECURITY.md`. |
| `STORAGE_DRIVER` | no (default `local`) | Selects the Asset/File service's storage backend (`src/lib/storage.ts`): `local` (disk, dev-only) or `s3` (any S3-compatible object storage — Cloudflare R2 in production as of Session 32). See `docs/ASSETS.md`. |
| `ASSET_STORAGE_LOCAL_ROOT` | no (default `<repo>/var/asset-storage`) | Where the local-disk storage driver writes uploaded file bytes. Outside `public/`; never served directly, only through the authorized `assets/[id]/download` routes. Only relevant when `STORAGE_DRIVER=local`. |
| `S3_BUCKET` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_REGION` | required when `STORAGE_DRIVER=s3` | S3-compatible object storage config for `S3StorageDriver` (Session 32). `S3_ENDPOINT` is the account-scoped API endpoint (e.g. R2's `https://<account_id>.r2.cloudflarestorage.com`, no bucket/path segment — the driver appends `/<bucket>/<key>` itself). `S3_REGION` defaults to `auto` (R2's SigV4 region) if unset. **Set in production as of Session 32** — bucket + credential provisioning documented in `terraform/portal-storage.tf` and `docs/ASSETS.md`'s "Session 32" section; the credential itself lives only in `portal-secrets`, never here or in git. |
| `ASSET_MAX_SIZE_BYTES` | no (default 26214400 / 25 MiB) | Upload size cap enforced by `src/lib/assets.ts`'s `uploadAsset()`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes, for Google sign-in | OAuth client credentials for the Google provider (`src/lib/auth.ts`) — see `docs/FEDERATED_AUTH.md`. Register `https://<subdomain>.<root-domain>/auth/callback/google` as an authorized redirect URI per environment in Google Cloud Console. Without these set, Google sign-in fails at the provider level; password login is unaffected. **Set in production as of Session 22** — see `docs/QA_LIVE_TEST_ACCOUNTS.md` for the Traefik/Cloudflare-Tunnel forwarded-headers fix that was also required before this actually worked. |
| `RESEND_API_KEY` / `MAIL_FROM_ADDRESS` | yes, in production | Transactional email (`src/lib/mailer.ts`'s `sendMail()`) — see `docs/FEDERATED_AUTH.md`. Unset (or outside production) keeps the dev-console-log stub; production throws immediately if either is missing. **Set in production as of Session 22**, real delivery confirmed end-to-end (see `docs/QA_LIVE_TEST_ACCOUNTS.md`). |
| `AUTH_URL` | **do not set** | Not used anywhere in this repo and not required by Auth.js when `trustHost: true` is set (as `src/lib/auth.ts` does) — Next-Auth treats it as an override that replaces the per-subdomain Host-based URL construction this app's multi-tenant routing depends on. Session 22 found it set in `portal-secrets` (origin unknown — possibly a leftover from an old NextAuth v4 `NEXTAUTH_URL` habit) silently forcing every subdomain's OAuth `redirect_uri` to the one hardcoded host; removed. If something in the future seems to need it, that's a signal something else is misconfigured, not a reason to re-add it. |

## Secrets handling

- Secrets never live in this repo (`.env`/`.env.local` are gitignored).
- Production secrets are a k8s `Secret` (`portal-secrets`) consumed via
  `envFrom`, populated out-of-band (not by this repo's CI) — rotating one
  means updating the k8s Secret and rolling the deployment.
- CI-time secrets (`PORTAL_DATABASE_URL_PROD`, `GITHUB_TOKEN`) are GitHub
  Actions secrets scoped to the `production` Environment, which requires
  manual approval before a workflow run can read them.
- Encryption at rest: Postgres data lives on `postgres01`'s ZFS mirrored
  pool (`tank`) — ZFS does not encrypt at rest by default; whether
  encryption-at-rest is required before real production data lands is an
  infra decision, flagged as a limitation in the Session 01 handoff (see
  `status/project-status.md`).
