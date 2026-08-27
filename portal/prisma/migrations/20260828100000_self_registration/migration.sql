-- Session 18 (B2B & B2C Onboarding): public self-service registration.
--
-- There is no signup route anywhere in this repo before this session —
-- every account so far is admin/seed-provisioned via src/lib/users.ts's
-- createUser(), which requires users.create (an ADMIN-held permission).
-- Self-registration has no actor/session/permission at the point the new
-- User row is being inserted — same "pre-auth" situation Session 02 already
-- solved for the credentials lookup (app.auth_lookup) and password-reset
-- token consumption (app.password_reset_lookup), and Session 16 solved for
-- rate-limit's pre-auth COUNT (app.rate_limit_lookup).
--
-- New session var: app.self_registration — set ONLY by
-- src/lib/registration.ts's registerUser(), for exactly the one INSERT
-- into "users" (the new account) and its accompanying INSERT into
-- "user_roles" (the single TEACHER or STUDENT role every registered user
-- gets — see ROLE_NAMES/registerUser's REGISTERABLE_ROLES). Never set
-- anywhere else. Both users_select/user_roles_select also need the
-- carve-out: Prisma's nested `user.create({ data: { userRoles: { create }
-- } })` performs INSERT ... RETURNING on both tables, and Postgres RLS
-- enforces the SELECT policy on any row returned by an INSERT, exactly the
-- same RETURNING pitfall documented on users_select's app.auth_lookup
-- carve-out and audit_events_write.
--
-- Scope note: like auth_lookup/password_reset_lookup/rate_limit_lookup,
-- this widens the INSERT/SELECT policies for the whole statement while the
-- flag is set, not just "this one row" — RLS cannot restrict by query
-- shape. Safe because only src/lib/registration.ts's registerUser() ever
-- sets it, and that function only ever inserts exactly one users row (with
-- a fresh, server-generated id it cannot spoof onto an existing account —
-- the email @unique constraint is the real anti-collision guard) and one
-- user_roles row for that same brand-new user.
DROP POLICY "users_select" ON "users";
CREATE POLICY users_select ON "users" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_lookup', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
  OR current_setting('app.self_registration', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.create'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.update'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.suspend'
);

DROP POLICY "users_write" ON "users";
CREATE POLICY users_write ON "users" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.self_registration', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.create'
);

DROP POLICY "user_roles_select" ON "user_roles";
CREATE POLICY user_roles_select ON "user_roles" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.self_registration', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'roles.manage'
);

DROP POLICY "user_roles_write" ON "user_roles";
CREATE POLICY user_roles_write ON "user_roles" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.self_registration', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'roles.manage'
);
