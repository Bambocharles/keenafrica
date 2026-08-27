-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('active', 'deleted');

-- CreateEnum
CREATE TYPE "AssetEntityType" AS ENUM ('lesson_resource');

-- AlterTable
ALTER TABLE "resources" ADD COLUMN     "asset_id" UUID,
ALTER COLUMN "url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploader_id" UUID NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_id" UUID NOT NULL,
    "entity_type" "AssetEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "attached_by" UUID NOT NULL,
    "attached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");

-- CreateIndex
CREATE INDEX "assets_uploader_id_idx" ON "assets"("uploader_id");

-- CreateIndex
CREATE INDEX "asset_attachments_asset_id_idx" ON "asset_attachments"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_attachments_entity_type_entity_id_key" ON "asset_attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_asset_id_key" ON "resources"("asset_id");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_attached_by_fkey" FOREIGN KEY ("attached_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A Resource is either an external link (url set, unchanged since Session
-- 04) or a real uploaded file (asset_id set, Session 13) — never both,
-- never neither. Prisma's schema DSL has no CHECK syntax, so this is
-- hand-authored directly in the migration, same convention as every RLS
-- policy below.
ALTER TABLE "resources" ADD CONSTRAINT "resources_url_or_asset_check"
  CHECK (("url" IS NOT NULL) OR ("asset_id" IS NOT NULL));

-- Row-Level Security
--
-- Session 13 (Files & Content Assets). Postgres never stores binary
-- content (see src/lib/storage.ts) — these two tables are metadata/
-- ownership/visibility only.
--
-- assets: NO DELETE policy at all, for ANY role including super_admin —
-- the metadata row is permanent history (same append-only spirit as
-- lesson_versions/audit_events), so an attachment can never point at a
-- silently-vanished row. "Deleting" an asset is an application-layer
-- soft-delete (assets_update flips status to 'deleted', src/lib/assets.ts)
-- that also purges the underlying storage bytes.
--
-- asset_attachments: a genuinely live join (an asset is either currently
-- attached somewhere or it isn't), same shape as cohort_teachers — DELETE
-- is real and ownership-scoped identically to asset_attachments_write, so
-- content.ts's removeResource() can cleanly detach an asset when its
-- Resource row is removed.
--
-- assets_select cascades through asset_attachments_select, which in turn
-- cascades through resources_select (already RLS-protected, itself
-- cascading through lessons_select) for entity_type = 'lesson_resource' —
-- the exact "a subquery against an RLS-protected table is itself subject
-- to that table's SELECT policy" convention already used by
-- lesson_versions_select/resources_select in the education_core migration.
-- A future entity_type (message/sponsor_document/certificate, Sessions
-- 09/11/14) needs its own additive branch in asset_attachments_select
-- mirroring whatever that entity's own RLS-protected table already
-- enforces — never a parallel access-control mechanism.
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_attachments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_select ON "assets" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "assets"."uploader_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR EXISTS (SELECT 1 FROM asset_attachments aa WHERE aa."asset_id" = "assets"."id")
);

-- Any authenticated user may create an Asset row FOR THEMSELVES (uploading
-- bytes to your own storage slot needs no special permission) — what that
-- upload is actually allowed to attach to is gated entirely by
-- asset_attachments_write below, mirroring how resources_write (not
-- assets_write) is where courses.content.write + cohort ownership is
-- actually enforced.
CREATE POLICY assets_write ON "assets" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "assets"."uploader_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

-- Soft-delete only (status -> 'deleted', deleted_at set) — see
-- src/lib/assets.ts. No other column is ever updated through the app.
CREATE POLICY assets_update ON "assets" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "assets"."uploader_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "assets"."uploader_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

-- NOTE ON RECURSION: this policy deliberately does NOT re-check
-- assets.uploader_id via a subquery against "assets" — an earlier draft did,
-- and assets_select ALSO subqueries "asset_attachments" (to cascade
-- visibility for non-uploader viewers), so evaluating either policy
-- re-triggered the other and Postgres raised "infinite recursion detected
-- in policy" (42P17) — reproduced live by this session's own
-- assets-rls.integration.test.ts, same class of bug as Session 08's
-- assessments_select <-> assessment_assignments_select cycle. Unlike that
-- case this doesn't need a denormalized column to fix: nothing in
-- src/lib/assets.ts's canAccessAsset() actually depends on an
-- attachment-table query to grant the uploader access — it checks
-- asset.uploaderId directly (via assets_select, which has its own
-- independent uploader_id branch) BEFORE ever querying asset_attachments.
-- So the uploader branch here was redundant for every real caller; removing
-- it breaks the cycle with no loss of actual authorized access.
CREATE POLICY asset_attachments_select ON "asset_attachments" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND EXISTS (SELECT 1 FROM resources r WHERE r."id" = "asset_attachments"."entity_id")
  )
);

CREATE POLICY asset_attachments_write ON "asset_attachments" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM resources r JOIN lessons l ON l.id = r.lesson_id
      JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE r."id" = "asset_attachments"."entity_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);

CREATE POLICY asset_attachments_delete ON "asset_attachments" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.manage'
  OR (
    "asset_attachments"."entity_type" = 'lesson_resource'
    AND coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'courses.content.write'
    AND EXISTS (
      SELECT 1 FROM resources r JOIN lessons l ON l.id = r.lesson_id
      JOIN cohorts c ON c.course_id = l.course_id
      JOIN cohort_teachers ct ON ct.cohort_id = c.id
      WHERE r."id" = "asset_attachments"."entity_id" AND ct.teacher_user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
);
