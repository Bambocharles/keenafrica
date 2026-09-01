-- Session 36 (Keen Africans — Profile & Identity). The Profile entity.
--
-- A deliberately separate table from "users" — see schema.prisma's
-- User.profile field comment for the full reasoning. In short: "users" has
-- no anonymous SELECT branch at all, by design (Session 02), and Session
-- 34's own incident (articles.ts's authorNamesByIds() workaround) is a
-- direct consequence of that boundary. Profile holds ONLY public-safe
-- columns (no email/password_hash/is_super_admin/status), so its SELECT
-- policy can simply be open to everyone — no elevated/system RLS context
-- ever needed to read it, unlike the users table.
--
-- Created lazily, once per user, by src/lib/profiles.ts's ensureProfile() —
-- called from the keenafricans register Server Action (so the one
-- registration-time field, country, has somewhere to land) and from every
-- keenafricans protected page's layout (so a Google-sign-in account, which
-- never runs the register Server Action, still gets one on first visit).
-- username/display_name are always set at creation (auto-generated from the
-- registration name), so a public profile page and an article byline never
-- need to fall back to a live "users" read except as a defensive fallback
-- for an account with no profile row at all yet (src/lib/articles.ts's
-- resolveAuthorName()).
CREATE TABLE "profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT,
    "country" TEXT,
    "profession" TEXT,
    "interests" TEXT[] NOT NULL DEFAULT '{}',
    "linkedin_url" TEXT,
    "github_url" TEXT,
    "website_url" TEXT,
    "x_url" TEXT,
    "avatar_asset_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");
CREATE INDEX "profiles_user_id_idx" ON "profiles"("user_id");

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- avatar_asset_id references "assets" — added once "assets" already
-- exists (Session 13); no ordering issue since that migration is long
-- since applied.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_asset_id_fkey" FOREIGN KEY ("avatar_asset_id") REFERENCES "assets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- profiles_select: unconditionally open. This is the entire point of
-- splitting Profile out of "users" — a public profile page
-- (keenafricans.<root>/u/<username>) and an article byline link both read
-- this table with NO app.user_id set at all (withRls({})), exactly like
-- articles_select already does for published articles. Every column on
-- this table is safe to expose to an anonymous reader by construction (see
-- the CREATE TABLE comment above) — there is no draft/published gate here
-- the way there is for Article, because a profile itself carries no
-- unpublished content of its own to protect.
--
-- profiles_write/update: self-only (user_id = app.user_id) or super_admin.
-- No permission-key gate is needed (unlike articles.write) — there is
-- nothing ownership-scoped to check beyond "is this your own row," and
-- every authenticated user is entitled to their own profile. Mirrors
-- totp_credentials'/recovery_codes' "user_id = app.user_id" self-only
-- shape (mfa_account_security migration) more closely than articles'
-- permission-gated shape.
--
-- No DELETE policy — a profile is never hard-deleted in this session's
-- scope (same append-only-by-default spirit as articles/assets/
-- certificates); revisit only if a future session adds account deletion.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON "profiles" FOR SELECT USING (true);

CREATE POLICY profiles_write ON "profiles" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "profiles"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

CREATE POLICY profiles_update ON "profiles" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "profiles"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "profiles"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
