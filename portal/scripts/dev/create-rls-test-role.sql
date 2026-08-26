-- Creates a NON-superuser Postgres role for local dev, matching production's
-- kf_portal_prod_app in the one way that actually matters for testing RLS:
-- it does NOT bypass Row-Level Security. The default local dev setup
-- (README.md) connects as the `postgres` superuser, which ALWAYS bypasses
-- RLS regardless of policies or session vars — meaning RLS policies are
-- silently unverified by anything that runs against that connection,
-- including withRls(). This role exists so a small, targeted test suite
-- (src/lib/rls.integration.test.ts) can prove the actual Postgres-level
-- enforcement, not just the application-layer permission checks in front
-- of it.
--
-- Usage (against the docker-run dev Postgres from README.md):
--   docker exec -i <container> psql -U postgres -d portal_dev \
--     < scripts/dev/create-rls-test-role.sql
--
-- Then export RLS_TEST_DATABASE_URL, e.g.:
--   export RLS_TEST_DATABASE_URL=postgresql://portal_rls_test:portal_rls_test_dev_only@localhost:55432/portal_dev
--
-- Idempotent — safe to re-run. Local dev/test only; never run this against
-- a production/staging database (production already has the real
-- kf_portal_prod_app role, provisioned out-of-band — see docs/ENVIRONMENT.md).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'portal_rls_test') THEN
    CREATE ROLE portal_rls_test LOGIN PASSWORD 'portal_rls_test_dev_only' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO portal_rls_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO portal_rls_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO portal_rls_test;
