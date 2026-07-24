# Keen Africa Partner Portal

Multi-tenant sponsor/project portal. A super-admin creates a sponsor +
project from the admin console; each project gets a subdomain
(`{slug}.keenafrica.com`) automatically, resolved by `middleware.ts` from
the `Host` header — no redeploy needed per project.

Deploys straight to production (`keen-prod`) — there is no separate
dev-prefixed portal environment. The mechanism was verified end-to-end in
an isolated `*.dev.keenafrica.com` setup during Phase 1 before this cutover;
that environment was retired afterward to free resources on the node.

## Local development

```bash
npm install
npx prisma generate
DATABASE_URL=postgresql://... npx prisma migrate dev
npm run dev
```

Add `/etc/hosts` entries pointing `admin.portal.local` and any test project
slug at `127.0.0.1`, with `ROOT_DOMAIN=portal.local`, to exercise the
subdomain routing locally without touching real DNS.

## Deploying

Pushes to `main` touching this directory trigger `deploy-portal.yml`
automatically, gated by the `production` GitHub Environment's manual
approval (same gate the static site's prod deploy uses). Can also be
re-run manually (e.g. after fixing a secret without any code change) via
Actions → Deploy Portal → Run workflow.

## Architecture notes

- Auth.js routes are mounted at `/auth`, not the default `/api/auth` — a
  Cloudflare Worker intercepts `/api/*` on every hostname in the zone (see
  `../terraform/worker.tf`) and would otherwise swallow them.
- Multi-tenant isolation is enforced with Postgres Row-Level Security, not
  app-layer filtering — see `prisma/migrations/*/migration.sql` and
  `src/lib/rls.ts`. Every RLS-scoped query must go through `withRls()`.
- The runtime app connects as the `kf_portal_prod_app` role (no `BYPASSRLS`,
  no superuser). Migrations run as `kf_portal_prod_migrator`, which owns the
  tables and legitimately bypasses RLS as the table owner.
- `PRISMA_QUERY_ENGINE_LIBRARY` is set explicitly in the Docker runtime
  stage — Prisma 5.x's engine auto-detection picks the wrong (pre-OpenSSL-3)
  binary on current Alpine even though the correct one is also generated.
- `HOSTNAME=0.0.0.0` is set explicitly in both the Dockerfile and the k8s
  manifest — Kubernetes sets `HOSTNAME` to the pod name for every container,
  which makes Next.js's standalone server bind only to the pod's own IP
  instead of all interfaces otherwise.
