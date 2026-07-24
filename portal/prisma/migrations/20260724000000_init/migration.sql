-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Enums
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'active', 'paused');
CREATE TYPE "MembershipRole" AS ENUM ('sponsor_admin', 'beneficiary');

-- Tables
CREATE TABLE "users" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email"          citext NOT NULL,
    "password_hash"  text NOT NULL,
    "name"           text NOT NULL,
    "is_super_admin" boolean NOT NULL DEFAULT false,
    "created_at"     timestamptz NOT NULL DEFAULT now(),
    "updated_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "sponsors" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name"       text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "projects" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "sponsor_id" uuid NOT NULL REFERENCES "sponsors"("id"),
    "name"       text NOT NULL,
    "slug"       text NOT NULL,
    "status"     "ProjectStatus" NOT NULL DEFAULT 'active',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

CREATE TABLE "project_memberships" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"    uuid NOT NULL REFERENCES "users"("id"),
    "project_id" uuid NOT NULL REFERENCES "projects"("id"),
    "role"       "MembershipRole" NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "project_memberships_user_id_project_id_key" ON "project_memberships"("user_id", "project_id");

-- Row-Level Security
-- Session vars set per-request via withRls(): app.user_id, app.is_super_admin,
-- app.auth_lookup. See portal/src/lib/rls.ts.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sponsors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_memberships" ENABLE ROW LEVEL SECURITY;

-- users: self, or super_admin, or the one narrow pre-auth login lookup
-- (app.auth_lookup is set only by the Auth.js authorize() callback, for a
-- single parameterized exact-email-match query — never for anything else).
CREATE POLICY users_select ON "users" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_lookup', true) = 'true'
);
CREATE POLICY users_write ON "users" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY users_update ON "users" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY users_delete ON "users" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);

-- sponsors: names aren't sensitive (public partner orgs) — public read,
-- super_admin-only write.
CREATE POLICY sponsors_select ON "sponsors" FOR SELECT USING (true);
CREATE POLICY sponsors_write ON "sponsors" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY sponsors_update ON "sponsors" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY sponsors_delete ON "sponsors" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);

-- projects: public sees active only (needed by the unauthenticated
-- {slug}.dev.keenafrica.com placeholder page); super_admin sees everything.
CREATE POLICY projects_select ON "projects" FOR SELECT USING (
  "status" = 'active' OR current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY projects_write ON "projects" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY projects_update ON "projects" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY projects_delete ON "projects" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);

-- project_memberships: super_admin, or a user seeing their own memberships
CREATE POLICY memberships_select ON "project_memberships" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY memberships_write ON "project_memberships" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY memberships_update ON "project_memberships" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
);
CREATE POLICY memberships_delete ON "project_memberships" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
);
