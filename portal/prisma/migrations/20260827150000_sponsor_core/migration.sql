-- Session 11 (Sponsor) — extends the Phase-1 Sponsor/Project/
-- ProjectMembership scaffold. Adds Milestone/ProjectMetric/ProjectDocument
-- (all RLS-protected from the start), a new 'sponsor_document'
-- AssetEntityType value (its asset_attachments RLS branch lands in the
-- immediately-following migration — a just-added enum value cannot be used
-- in the same transaction that adds it, same constraint documented in the
-- messaging_asset_attachments migration), and rebuilds sponsors/projects/
-- project_memberships authorization on Session 02's Role/Permission model
-- (sponsor.manage / sponsor.projects.read / sponsor.users.manage) instead
-- of the ad hoc "is_super_admin or self-row-only" policies the Phase-1
-- scaffold shipped with.
--
-- Ownership model: a ProjectMembership row with role='sponsor_admin' is
-- the "sponsor-side project team" relationship (mirrors cohort_teachers)
-- — see that model's own doc comment in schema.prisma for why this is
-- orthogonal to the global SPONSOR_ADMIN/SPONSOR_USER Role.
--
-- RECURSION NOTE: project_memberships_select needs "does another row in
-- this same table put me on this project's sponsor team" — a genuine
-- self-referencing check, the same failure class documented in the
-- messaging_core/messaging_cohort_visibility migrations
-- ("infinite recursion detected in policy"). app_current_user_sponsor_
-- project_ids(), a SECURITY DEFINER function (same convention as
-- app_current_user_conversation_ids()/app_current_user_enrolled_cohort_ids()),
-- runs as the table owner (bypasses RLS, opaque to the RLS rewriter) so it
-- never re-triggers the policy it's used from. Used consistently below for
-- every "is this project one of my sponsor-team projects" check, not just
-- the self-referencing one, for a single source of truth.

CREATE FUNCTION app_current_user_sponsor_project_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT project_id FROM project_memberships
  WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND role = 'sponsor_admin'
$$;

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('planned', 'in_progress', 'achieved', 'missed');

-- AlterEnum
ALTER TYPE "AssetEntityType" ADD VALUE 'sponsor_document';

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_date" TIMESTAMPTZ(6),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'planned',
    "achieved_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- CreateIndex
CREATE INDEX "project_metrics_project_id_label_recorded_at_idx" ON "project_metrics"("project_id", "label", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_documents_asset_id_key" ON "project_documents"("asset_id");

-- CreateIndex
CREATE INDEX "project_documents_project_id_idx" ON "project_documents"("project_id");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_metrics" ADD CONSTRAINT "project_metrics_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security -------------------------------------------------------

ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_documents" ENABLE ROW LEVEL SECURITY;

-- milestones/project_metrics: admin/staff-authored (sponsor.manage),
-- read-only for the project's sponsor-side team. No update/delete RLS
-- policy on project_metrics at all — append-only, a correction is a new
-- sample (see schema.prisma's doc comment on that model).
CREATE POLICY "milestones_select" ON "milestones" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR "milestones"."project_id" IN (SELECT app_current_user_sponsor_project_ids())
);
CREATE POLICY "milestones_write" ON "milestones" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
CREATE POLICY "milestones_update" ON "milestones" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
CREATE POLICY "milestones_delete" ON "milestones" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);

CREATE POLICY "project_metrics_select" ON "project_metrics" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR "project_metrics"."project_id" IN (SELECT app_current_user_sponsor_project_ids())
);
CREATE POLICY "project_metrics_write" ON "project_metrics" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);

-- project_documents: the anchor row for a 'sponsor_document' asset
-- attachment (see schema.prisma). Same admin-authored/sponsor-read-only
-- shape as milestones/project_metrics.
CREATE POLICY "project_documents_select" ON "project_documents" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR "project_documents"."project_id" IN (SELECT app_current_user_sponsor_project_ids())
);
CREATE POLICY "project_documents_write" ON "project_documents" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
CREATE POLICY "project_documents_delete" ON "project_documents" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);

-- Widen the Phase-1 scaffold's policies off is_super_admin-only ---------

-- sponsors: unchanged public SELECT (names aren't sensitive — see the
-- init migration); write/update/delete widen from super-admin-only to
-- super-admin-OR-sponsor.manage, same pattern as Session 03's
-- feature_flags_update widening for flags.manage.
DROP POLICY "sponsors_write" ON "sponsors";
CREATE POLICY "sponsors_write" ON "sponsors" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
DROP POLICY "sponsors_update" ON "sponsors";
CREATE POLICY "sponsors_update" ON "sponsors" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
DROP POLICY "sponsors_delete" ON "sponsors";
CREATE POLICY "sponsors_delete" ON "sponsors" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);

-- projects: SELECT widens to also include a project the caller's
-- sponsor-side team is on (draft/paused projects included — a sponsor
-- team member previewing their own not-yet-public project is legitimate,
-- unlike the public/unauthenticated case this policy also still serves).
DROP POLICY "projects_select" ON "projects";
CREATE POLICY "projects_select" ON "projects" FOR SELECT USING (
  "status" = 'active'
  OR current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR "projects"."id" IN (SELECT app_current_user_sponsor_project_ids())
);
DROP POLICY "projects_write" ON "projects";
CREATE POLICY "projects_write" ON "projects" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
DROP POLICY "projects_update" ON "projects";
CREATE POLICY "projects_update" ON "projects" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
DROP POLICY "projects_delete" ON "projects";
CREATE POLICY "projects_delete" ON "projects" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);

-- project_memberships: SELECT widens from "self row only" to also let a
-- sponsor-team member see their fellow team members AND the (privacy-
-- scoped, see src/lib/sponsor.ts) beneficiary membership rows on a
-- project they're on themselves — via the SECURITY DEFINER helper, never
-- a raw self-subquery (see this migration's header "RECURSION NOTE").
-- INSERT: sponsor.manage (admin) can create either role; a
-- sponsor.users.manage holder who is themselves a sponsor-team member on
-- the target project may only invite ANOTHER sponsor_admin-role row
-- (never create a beneficiary row — that stays an admin-only action, so a
-- sponsor org can never self-enroll a "beneficiary" the education/admin
-- side hasn't actually placed in the project).
DROP POLICY "memberships_select" ON "project_memberships";
CREATE POLICY "memberships_select" ON "project_memberships" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR "project_memberships"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR "project_memberships"."project_id" IN (SELECT app_current_user_sponsor_project_ids())
);
DROP POLICY "memberships_write" ON "project_memberships";
CREATE POLICY "memberships_write" ON "project_memberships" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.users.manage'
    AND "project_memberships"."role" = 'sponsor_admin'
    AND "project_memberships"."project_id" IN (SELECT app_current_user_sponsor_project_ids())
  )
);
DROP POLICY "memberships_update" ON "project_memberships";
CREATE POLICY "memberships_update" ON "project_memberships" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
);
DROP POLICY "memberships_delete" ON "project_memberships";
CREATE POLICY "memberships_delete" ON "project_memberships" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.manage'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'sponsor.users.manage'
    AND "project_memberships"."role" = 'sponsor_admin'
    AND "project_memberships"."project_id" IN (SELECT app_current_user_sponsor_project_ids())
  )
);
