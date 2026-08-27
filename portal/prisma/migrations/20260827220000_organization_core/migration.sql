-- Session 17 (Organization Core) — a fourth pillar alongside Platform/
-- Education/Sponsor Core (PLATFORM_ARCHITECTURE.md §14). Organization is a
-- general membership/tenant boundary for teachers/students, deliberately
-- separate from Sponsor (a funding/project relationship) — not merged,
-- renamed, or made a parent of it. See schema.prisma's header comment on
-- this section and docs/ORGANIZATION_CORE.md for the full contract.
--
-- No organizationId column on "users" anywhere in this migration — the
-- ONLY path from a user to an organization is organization_memberships,
-- per PLATFORM_CONTEXT.md's explicit rule (a person may belong to zero,
-- one, or many organizations).
--
-- New RLS session var: app.organization_ids — a server-resolved JSON array
-- of the organization ids the caller holds an ACTIVE membership in (any
-- role), set by withRls() alongside app.user_id/app.is_super_admin/
-- app.permissions (see src/lib/rls.ts, src/lib/sessions.ts's
-- resolveSessionAuthz — resolved the same way roles/permissions already
-- are, never trusted from the client). Tested with the jsonb-array-membership
-- expression used throughout this migration's policies below; Session 21
-- (Organization-Aware Education) reuses the exact same expression against
-- Course/Cohort/Assessment/Question once those gain organizationId.
--
-- New RLS session var: app.org_invitation_lookup — set ONLY by
-- src/lib/organizations.ts's acceptOrganizationInvitation(), for the
-- token-authorized (not app.user_id/app.organization_ids-authorized)
-- invitation lookup/consume and the resulting membership-row creation,
-- mirroring the existing app.password_reset_lookup convention exactly.
--
-- RECURSION NOTE: "does the caller hold an ACTIVE org_admin membership in
-- organization X" requires a self-referencing check against
-- organization_memberships from within that same table's own policy — the
-- same failure class documented in the messaging_core/sponsor_core
-- migrations ("infinite recursion detected in policy for relation").
-- app_current_user_admin_organization_ids(), a SECURITY DEFINER function
-- (same convention as app_current_user_sponsor_project_ids()/
-- app_current_user_conversation_ids()), runs as the table owner (bypasses
-- RLS, opaque to the RLS rewriter) so it never re-triggers the policy it's
-- used from. Defined further below, right before it's first used, because
-- (unlike app_current_user_sponsor_project_ids(), whose "project_memberships"
-- table already existed from a prior migration) organization_memberships is
-- created by THIS migration — the function can't reference it before the
-- CREATE TABLE runs.

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('school', 'church', 'company', 'ngo', 'training_center', 'government', 'university', 'community', 'personal', 'other');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('pending', 'active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "OrganizationMembershipRole" AS ENUM ('org_admin', 'org_member');

-- CreateEnum
CREATE TYPE "OrganizationMembershipStatus" AS ENUM ('invited', 'pending', 'active', 'suspended', 'removed');

-- CreateEnum
CREATE TYPE "OrganizationInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL DEFAULT 'other',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "verified_at" TIMESTAMPTZ(6),
    "description" TEXT,
    "logo_url" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrganizationMembershipRole" NOT NULL DEFAULT 'org_member',
    "status" "OrganizationMembershipStatus" NOT NULL DEFAULT 'invited',
    "invited_by" UUID,
    "joined_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "OrganizationMembershipRole" NOT NULL DEFAULT 'org_member',
    "token_hash" TEXT NOT NULL,
    "status" "OrganizationInvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_created_by_idx" ON "organizations"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_idx" ON "organization_memberships"("user_id");
CREATE INDEX "organization_memberships_organization_id_idx" ON "organization_memberships"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE INDEX "organization_invitations_organization_id_idx" ON "organization_invitations"("organization_id");
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations"("email");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security -------------------------------------------------------

CREATE FUNCTION app_current_user_admin_organization_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM organization_memberships
  WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND role = 'org_admin'
    AND status = 'active'
$$;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_invitations" ENABLE ROW LEVEL SECURITY;

-- organizations: any authenticated caller may see any non-archived
-- organization's basic profile (Session 18's "search/select an
-- organization to join" flow needs this — same "catalog-ish, not secret"
-- reasoning as sponsors_select, just gated to authenticated rather than
-- fully public since this row carries contact_email/contact_phone).
-- A member (any role, via app.organization_ids) can also see their OWN
-- organization even once archived. super_admin/organizations.manage see
-- everything unconditionally, matching every other admin-manage widening
-- in this codebase.
--
-- WRITE (create): deliberately NOT organizations.manage-gated — any
-- authenticated user may found a new organization and become its
-- org_admin (Session 18's self-service "create a new organization" path),
-- same way any authenticated user can create their own session row.
-- created_by must equal the acting user (or a super_admin/manage override
-- creating on someone's behalf), so a caller can never attribute a new org
-- to a different creator.
--
-- UPDATE (settings): super_admin, organizations.manage, or an org_admin of
-- THAT specific organization (via the SECURITY DEFINER helper above).
--
-- No DELETE policy at all — archival (status = 'archived') is the
-- deletion path, same "lifecycle over destructive delete" convention as
-- audit_events/lesson_versions/asset rows.
CREATE POLICY "organizations_select" ON "organizations" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR ("status" <> 'archived' AND nullif(current_setting('app.user_id', true), '') IS NOT NULL)
  OR "id"::text = ANY (
    SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
  )
);
CREATE POLICY "organizations_write" ON "organizations" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "created_by" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY "organizations_update" ON "organizations" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "id" IN (SELECT app_current_user_admin_organization_ids())
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "id" IN (SELECT app_current_user_admin_organization_ids())
);

-- organization_memberships: the core membership-gating table.
--
-- SELECT: super_admin/manage see everything. A caller always sees their
-- OWN row (any status — so an invited/pending user can see their own
-- membership state). An org_admin (via the SECURITY DEFINER helper) sees
-- every row — any status — in THEIR org, needed to manage the invite/
-- approve/suspend/remove lifecycle. A plain ACTIVE member additionally
-- sees the ACTIVE roster of an organization they are themselves an ACTIVE
-- member of (via app.organization_ids) — but not other members'
-- invited/pending/suspended rows, which stay admin-only visibility
-- (privacy default; not specified further than this by the session
-- brief, kept conservative).
--
-- WRITE (create a new row): an org_admin of that organization can create
-- ANY row (any role/status — e.g. inviting a known existing user directly
-- at status='invited'). A user may create their OWN row at status='pending'
-- only (self-service join request — never 'active', so nobody can grant
-- themselves membership merely by supplying an organization id, per this
-- session's explicit Rule). The org_invitation_lookup flag additionally
-- allows the one narrow case of accepting a token-based
-- OrganizationInvitation (src/lib/organizations.ts's
-- acceptOrganizationInvitation) creating an 'active' row directly — the
-- invitation itself, already created by an org_admin/manage holder, is
-- the authorization for that specific insert.
--
-- UPDATE (status/role transitions): super_admin, organizations.manage, an
-- org_admin of that org, or the row's own user (self). RLS cannot
-- restrict *which* transition self is allowed to make (row-level, not
-- value-level — same documented limitation as users_update) — application
-- code (src/lib/organizations.ts) is the real gate on e.g. "self may
-- accept their own invited->active or leave (->removed), never approve
-- their own pending request or grant themselves org_admin."
--
-- No DELETE policy — removal is status='removed', not a row delete, same
-- convention as every other membership/lifecycle table in this codebase.
CREATE POLICY "organization_memberships_select" ON "organization_memberships" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR (
    "status" = 'active'
    AND "organization_id"::text = ANY (
      SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
    )
  )
);
CREATE POLICY "organization_memberships_write" ON "organization_memberships" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR (
    "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "status" = 'pending'
  )
  OR current_setting('app.org_invitation_lookup', true) = 'true'
  -- The organization's own founder becoming its first org_admin, in the
  -- same transaction as createOrganization()'s INSERT into "organizations"
  -- above — at this point app_current_user_admin_organization_ids() is
  -- still empty (no membership row exists yet), so this narrow branch is
  -- what actually authorizes it: self, role=org_admin, status=active,
  -- ONLY for an organization this same user just created. Not a
  -- self-referencing/recursive check (organizations has its own,
  -- independent policy — see the RECURSION NOTE above for what *would*
  -- recurse) and grants nothing beyond "found your own org."
  OR (
    "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "role" = 'org_admin'
    AND "status" = 'active'
    AND "organization_id" IN (
      SELECT "id" FROM "organizations" WHERE "created_by" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
CREATE POLICY "organization_memberships_update" ON "organization_memberships" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

-- organization_invitations: the email-based, pre-account invitation path.
-- SELECT: super_admin/manage, an org_admin of that org (managing invites
-- they or a co-admin sent), the pre-auth token-lookup flag (redeeming an
-- invitation by its raw token, mirroring password_reset_tokens_select's
-- app.password_reset_lookup carve-out), or an authenticated caller whose
-- own email matches the invited address (viewing their own pending
-- invite once logged in — a one-way reference to "users", not a cycle,
-- so this is not the RLS self-recursion trap documented above).
-- WRITE: org_admin of that org, organizations.manage, or super_admin only
-- — an invitation is never self-issued.
-- UPDATE: same actors as WRITE (e.g. an org_admin revoking an invite),
-- plus the token-lookup flag (marking accepted/expired during redemption).
-- No DELETE policy — same append/lifecycle convention as
-- password_reset_tokens.
CREATE POLICY "organization_invitations_select" ON "organization_invitations" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR current_setting('app.org_invitation_lookup', true) = 'true'
  OR "email" = (SELECT "email" FROM "users" WHERE "id" = nullif(current_setting('app.user_id', true), '')::uuid)
);
CREATE POLICY "organization_invitations_write" ON "organization_invitations" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
);
CREATE POLICY "organization_invitations_update" ON "organization_invitations" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR current_setting('app.org_invitation_lookup', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'organizations.manage'
  OR "organization_id" IN (SELECT app_current_user_admin_organization_ids())
  OR current_setting('app.org_invitation_lookup', true) = 'true'
);
