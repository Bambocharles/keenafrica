-- Session 40 (Keen Africans — LinkedIn Verification). See schema.prisma's
-- VerificationStatus/KeenAfricanVerification comments for the full design
-- (why this is a separate table from "profiles", why there is no
-- "unverified" enum value, and the exact scopes/API confirmed against
-- LinkedIn's current OpenID Connect docs).
--
-- Note: this migration deliberately does NOT touch
-- "user_identities_user_id_fkey" — `prisma migrate dev`'s diff proposed
-- dropping/recreating it (RESTRICT/CASCADE vs. the already-applied
-- NO ACTION/NO ACTION) purely because UserIdentity.user has never declared
-- explicit onDelete/onUpdate in schema.prisma; that's pre-existing drift
-- from Session 19, unrelated to this session's scope, so it was stripped
-- from the generated SQL rather than silently applied here.

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('linkedin_connected', 'verified', 'rejected');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "keen_african_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "linkedin_provider_account_id" TEXT,
    "linkedin_name" TEXT,
    "linkedin_picture_url" TEXT,
    "connected_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keen_african_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "keen_african_verifications_user_id_key" ON "keen_african_verifications"("user_id");

-- CreateIndex
CREATE INDEX "keen_african_verifications_user_id_idx" ON "keen_african_verifications"("user_id");

-- CreateIndex
CREATE INDEX "keen_african_verifications_status_idx" ON "keen_african_verifications"("status");

-- AddForeignKey
ALTER TABLE "keen_african_verifications" ADD CONSTRAINT "keen_african_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "keen_african_verifications" ADD CONSTRAINT "keen_african_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- keen_african_verifications_select: self, super_admin, verification.review
-- holders (the reviewer queue), OR status = 'verified' — the one publicly
-- visible fact (it's the badge itself). The public branch is intentionally
-- narrow (a boolean-shaped condition on one column, not "anyone can read
-- this table"): src/lib/verification.ts's getVerifiedUserIds() is the only
-- caller that runs anonymously, and it always selects just { userId: true },
-- never reviewedBy/reviewNote/the LinkedIn snapshot, even though RLS alone
-- would technically permit reading the full row once verified — same
-- "RLS is row-level, not column-level; the application's own query is the
-- other half of the guarantee" pattern articles_update's own comment
-- documents.
--
-- keen_african_verifications_self_connect (INSERT/UPDATE): the only
-- self-service path — src/lib/verification.ts's connectLinkedIn(), called
-- from the LinkedIn OAuth signIn callback with a real app.user_id already
-- set (this is reached only via the self-service "connect LinkedIn"
-- link-intent flow — see oauth-identity.ts's resolveLinkedInSignIn(), same
-- shape as Google's). WITH CHECK pins the resulting status to
-- 'linkedin_connected' no matter what — this is the actual DB-level
-- enforcement of "never let the badge be self-granted or automatically
-- granted purely by connecting LinkedIn" (sessions/40's explicit "Must
-- NOT"): even a hand-crafted UPDATE from an authenticated non-reviewer can
-- never set status to 'verified' through this policy.
--
-- keen_african_verifications_review (UPDATE only): verification.review or
-- super_admin, WITH CHECK restricted to status IN ('verified', 'rejected')
-- — a reviewer can only ever move a row to one of the two review-decision
-- states, never back to 'linkedin_connected' (that only happens via the
-- account owner reconnecting LinkedIn themselves).
--
-- No DELETE policy — same "append-only, no hard delete" convention as
-- articles/certificates; a verification's history stays on the row via
-- reviewedAt/reviewedBy/reviewNote even across a reject -> reconnect ->
-- re-review cycle.
ALTER TABLE "keen_african_verifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "keen_african_verifications_select" ON "keen_african_verifications" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'verification.review'
  OR "status" = 'verified'
);

CREATE POLICY "keen_african_verifications_self_connect" ON "keen_african_verifications" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "status" = 'linkedin_connected'
  )
);

CREATE POLICY "keen_african_verifications_self_reconnect" ON "keen_african_verifications" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    AND "status" = 'linkedin_connected'
  )
);

CREATE POLICY "keen_african_verifications_review" ON "keen_african_verifications" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'verification.review'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR (
    coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'verification.review'
    AND "status" IN ('verified', 'rejected')
  )
);

-- profiles_update amendment — adds an articles.manage branch so
-- src/lib/profiles.ts's setProfileFeatured() (the "Featured" editorial
-- flag this session's data model adds) can actually write another Keen
-- African's profile row; profiles_update was previously self-only/
-- super_admin (see keen_africans_profiles_core's own comment — "no
-- permission-key gate is needed" was true until this session added the
-- first admin-side write to someone else's profile). Row-level only, same
-- accepted "RLS is row-level, not column-level; the application's own
-- write shape is the other half of the guarantee" limitation
-- articles_update's own comment documents — setProfileFeatured() is the
-- only articles.manage-authorized caller of this table, and it only ever
-- writes the `featured` column.
DROP POLICY "profiles_update" ON "profiles";
CREATE POLICY "profiles_update" ON "profiles" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "profiles"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "profiles"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'articles.manage'
);

-- users_select amendment — adds a 'verification.review' branch, same shape
-- as the existing users.read/users.create/users.update/users.suspend
-- branches this policy already has (see the
-- users_select_cohort_relationship_org_boundary migration for the full
-- current text this replaces). Today verification.review is only ever
-- granted to ADMIN/SUPER_ADMIN, which already hold users.read too — but
-- Session 41's own brief explicitly leaves open whether a future, narrower
-- reviewer role (verification.review only, no users.read) should exist. If
-- that ever happens, src/lib/verification.ts's listPendingVerificationReviews()
-- (which reads the reviewed user's own name/email via a Prisma relation
-- include, the same pattern Session 34's own incident warns against doing
-- through an elevated system context instead of real RLS) would silently
-- break without this branch — added now, narrowly, rather than left as a
-- future landmine. Grants nothing beyond "see a user's own id/name/email
-- exists," identical in shape to what users.read already exposes.
DROP POLICY "users_select" ON "users";
CREATE POLICY "users_select" ON "users" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "users"."id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_lookup', true) = 'true'
  OR current_setting('app.password_reset_lookup', true) = 'true'
  OR current_setting('app.self_registration', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.create'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.update'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.suspend'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'verification.review'
  -- Teacher sees an actively enrolled student in a cohort the actor teaches.
  OR "users"."id" IN (
    SELECT e.student_user_id FROM enrollments e
    WHERE e.cohort_id IN (SELECT app_current_user_taught_cohort_ids())
      AND e.status IN ('active', 'completed')
      AND (
        app_cohort_organization_id(e.cohort_id) IS NULL
        OR app_cohort_organization_id(e.cohort_id)::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
        )
      )
  )
  -- Student sees a teacher of a cohort the actor is actively enrolled in.
  OR "users"."id" IN (
    SELECT ct.teacher_user_id FROM cohort_teachers ct
    WHERE ct.cohort_id IN (SELECT app_current_user_enrolled_cohort_ids())
      AND (
        app_cohort_organization_id(ct.cohort_id) IS NULL
        OR app_cohort_organization_id(ct.cohort_id)::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
        )
      )
  )
  -- Student sees a fellow actively-enrolled classmate in a shared cohort.
  OR "users"."id" IN (
    SELECT e.student_user_id FROM enrollments e
    WHERE e.cohort_id IN (SELECT app_current_user_enrolled_cohort_ids())
      AND e.status IN ('active', 'completed')
      AND (
        app_cohort_organization_id(e.cohort_id) IS NULL
        OR app_cohort_organization_id(e.cohort_id)::text = ANY (
          SELECT jsonb_array_elements_text(coalesce(nullif(current_setting('app.organization_ids', true), ''), '[]')::jsonb)
        )
      )
  )
);
