# Keen Africa Partner Portal (Phase 1)

Multi-tenant sponsor/project portal. A super-admin creates a sponsor +
project from the admin console; each project gets a subdomain
(`{slug}.dev.keenafrica.com`) automatically, resolved by `middleware.ts`
from the `Host` header — no redeploy needed per project.

## Local development

```bash
npm install
npx prisma generate
DATABASE_URL=postgresql://... npx prisma migrate dev
npm run dev
```

Add `/etc/hosts` entries pointing `admin.dev.keenafrica.com` and any test
project slug at `127.0.0.1` to exercise the subdomain routing locally.

## Architecture notes

- Auth.js routes are mounted at `/auth`, not the default `/api/auth` — a
  Cloudflare Worker intercepts `/api/*` on every hostname in the zone (see
  `../terraform/worker.tf`) and would otherwise swallow them.
- Multi-tenant isolation is enforced with Postgres Row-Level Security, not
  app-layer filtering — see `prisma/migrations/*/migration.sql` and
  `src/lib/rls.ts`. Every RLS-scoped query must go through `withRls()`.
- The runtime app connects as the `keenafrica_portal` role (no `BYPASSRLS`,
  no superuser). Migrations run as `keenafrica_migrator`, which owns the
  tables and legitimately bypasses RLS as the table owner.
- `PRISMA_QUERY_ENGINE_LIBRARY` is set explicitly in the Docker runtime
  stage — Prisma 5.x's engine auto-detection picks the wrong (pre-OpenSSL-3)
  binary on current Alpine even though the correct one is also generated.
