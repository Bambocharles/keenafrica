-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "suspended_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- New session var: app.permissions — a JSON array of the caller's
-- resolved permission keys for this request (e.g. '["sessions.revoke"]'),
-- set by withRls() alongside the existing app.user_id/app.is_super_admin.
-- Policies below test membership with the jsonb `?` (key exists) operator.
-- coalesce(nullif(...,''),'[]') guards any query that runs outside
-- withRls() (where the var is unset) from throwing on the ::jsonb cast.
--
-- New session var: app.password_reset_lookup — set ONLY by
-- src/lib/password-reset.ts for the pre-auth (no app.user_id yet)
-- token-hash lookup/consume, mirroring the existing app.auth_lookup
-- convention used by users_select for Auth.js's authorize() callback.

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

-- roles / permissions: catalog/lookup tables, not sensitive (role and
-- permission *names* aren't secrets) — public read, same pattern as
-- "sponsors"/"feature_flags". Write is super-admin ONLY, never delegated
-- via app.permissions: defining new role/permission types is a
-- platform-level decision, not something a "roles.manage" holder should
-- be able to do to themselves.
CREATE POLICY roles_select ON "roles" FOR SELECT USING (true);
CREATE POLICY roles_write ON "roles" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY roles_update ON "roles" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY roles_delete ON "roles" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);

CREATE POLICY permissions_select ON "permissions" FOR SELECT USING (true);
CREATE POLICY permissions_write ON "permissions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY permissions_update ON "permissions" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY permissions_delete ON "permissions" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);

-- role_permissions: what a role CAN do. Public read (any authenticated
-- request needs to resolve its own effective permission set from this
-- table before app.permissions even exists for that request). Write is
-- super-admin ONLY — see the privilege-escalation note above and in
-- schema.prisma's RolePermission model comment.
CREATE POLICY role_permissions_select ON "role_permissions" FOR SELECT USING (true);
CREATE POLICY role_permissions_write ON "role_permissions" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY role_permissions_update ON "role_permissions" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY role_permissions_delete ON "role_permissions" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);

-- user_roles: which role(s) a user holds. Self-read (a user can see their
-- own roles), super_admin, or users.read/roles.manage holders (e.g. an
-- ADMIN looking up who has which role). Write requires roles.manage or
-- super_admin — assigning existing roles to users, NOT defining what those
-- roles mean (that's role_permissions, locked above).
CREATE POLICY user_roles_select ON "user_roles" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'roles.manage'
);
CREATE POLICY user_roles_write ON "user_roles" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'roles.manage'
);
CREATE POLICY user_roles_delete ON "user_roles" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'roles.manage'
);

-- sessions: the DB-backed record that makes JWT-strategy sessions
-- revocable (see src/lib/sessions.ts). Self (own sessions), super_admin,
-- or sessions.read/sessions.revoke holders (troubleshooter diagnostics).
-- No DELETE policy at all — a session is revoked (revoked_at set), never
-- removed, so past-session history survives for audit/diagnostics.
-- sessions.revoke also grants read visibility (not just sessions.read):
-- Prisma's .update() always does UPDATE ... RETURNING, and Postgres RLS
-- additionally enforces the SELECT policy on any row returned by an
-- UPDATE/INSERT/DELETE — without this, a sessions.revoke-only holder could
-- revoke a session (the UPDATE policy allows it) but Prisma's own
-- RETURNING would then be rejected by this SELECT policy, breaking
-- revokeSession() for that caller. See rls.integration.test.ts and
-- audit_events_write's near-identical RETURNING pitfall.
CREATE POLICY sessions_select ON "sessions" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sessions.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sessions.revoke'
);
CREATE POLICY sessions_write ON "sessions" FOR INSERT WITH CHECK (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY sessions_update ON "sessions" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sessions.revoke'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sessions.revoke'
);

-- password_reset_tokens: locked to the narrow pre-auth lookup path (no
-- app.user_id exists yet when a reset link is used) plus super_admin, same
-- shape as users_select's app.auth_lookup carve-out.
CREATE POLICY password_reset_tokens_select ON "password_reset_tokens" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
);
CREATE POLICY password_reset_tokens_write ON "password_reset_tokens" FOR INSERT WITH CHECK (
  current_setting('app.password_reset_lookup', true) = 'true'
);
CREATE POLICY password_reset_tokens_update ON "password_reset_tokens" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
);

-- audit_events: append-only. INSERT is unconditional (WITH CHECK (true))
-- because it must succeed from contexts with no authenticated app.user_id
-- at all (e.g. recording a failed login against an unknown email) — every
-- insert goes through the single recordAuditEvent() helper, never a
-- client-exposed path. SELECT is super_admin or audit.read holders only.
-- Deliberately NO UPDATE/DELETE policy of any kind: RLS denies both by
-- default when no permissive policy exists, so no role — not even
-- super_admin — can alter or remove an audit record through the app.
CREATE POLICY audit_events_select ON "audit_events" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'audit.read'
);
CREATE POLICY audit_events_write ON "audit_events" FOR INSERT WITH CHECK (true);

-- Extend the pre-existing "users" policies (from the initial migration) to
-- recognize app.permissions holders alongside is_super_admin/self. This is
-- additive — every previously-authorized caller (self, super_admin,
-- auth_lookup) is still authorized identically; only new permission
-- holders (ADMIN's users.read/users.update/users.create/users.suspend,
-- TROUBLESHOOTER's users.read) gain access.
--
-- Row-level RLS cannot restrict *which columns* an UPDATE touches — e.g. a
-- users.suspend holder is DB-permitted to update any column on a users
-- row, not just status/suspended_at. The application layer is the real
-- gate on that distinction (see src/lib/users.ts: suspendUser() only ever
-- writes status/suspended_at, updateUserProfile() only ever writes name,
-- each behind its own permission check) — this policy is a coarse
-- backstop, not the fine-grained boundary. Documented here and in the
-- handoff so nobody mistakes this policy alone for column-level security.
-- users.create/users.update/users.suspend also grant read visibility, for
-- the same RETURNING-vs-SELECT-policy reason documented on sessions_select
-- above: Prisma's .create()/.update() do INSERT|UPDATE ... RETURNING, and
-- without this a users.create-only (etc.) holder could pass the
-- INSERT/UPDATE policy but have the RETURNING itself rejected by this
-- SELECT policy.
DROP POLICY "users_select" ON "users";
CREATE POLICY users_select ON "users" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_lookup', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.create'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.update'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.suspend'
);

DROP POLICY "users_write" ON "users";
CREATE POLICY users_write ON "users" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.create'
);

DROP POLICY "users_update" ON "users";
CREATE POLICY users_update ON "users" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.update'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.suspend'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.update'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.suspend'
);
-- users_delete is unchanged (super_admin only) — account deletion isn't in
-- this session's scope.
