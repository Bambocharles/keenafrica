-- MFA & Account Security (Session 20).
--
-- Extends the existing "sessions" table (Session 02) rather than building a
-- second session/device model:
--   - mfa_required: decided once at createSession() time by
--     src/lib/mfa.ts's shouldRequireLoginMfa() (the user already has TOTP
--     enabled, or their role is covered by the MFA policy hook). Never
--     re-derived from client input.
--   - mfa_verified_at: null until the second factor (or a recovery code) is
--     confirmed for THIS login. src/lib/sessions.ts's resolveSessionAuthz()
--     zeroes out roles/permissions/isSuperAdmin on every request while
--     mfa_required AND mfa_verified_at IS NULL, so a pending session can
--     reach nothing beyond the MFA challenge itself no matter which route
--     it's pointed at — enforced server-side in the same per-request
--     revalidation that already makes revocation immediate.
--   - step_up_verified_at: a short-lived "this session just re-proved its
--     current factor" freshness marker for src/lib/mfa.ts's
--     requireStepUp()/verifyStepUp(), gating sensitive actions
--     (docs/MFA_ACCOUNT_SECURITY.md has the full list).
--
-- No RLS policy changes are needed for these three columns: sessions_update
-- (Session 02's migration) already permits the row's own user (or
-- super_admin/sessions.revoke) to UPDATE any column on their own session
-- row, which is exactly the actor that ever writes these three fields.

-- AlterTable
ALTER TABLE "sessions"
  ADD COLUMN "mfa_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "step_up_verified_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "totp_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "totp_credentials_user_id_key" ON "totp_credentials"("user_id");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- AddForeignKey
ALTER TABLE "totp_credentials" ADD CONSTRAINT "totp_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security
--
-- Both new tables hold pure security material (an encrypted TOTP secret;
-- hashed recovery codes) for exactly one user. Self-row only, plus
-- super_admin (the unchanged, platform-wide RLS bypass every table in this
-- repo carries — see docs/IDENTITY_SECURITY.md). No permission-key branch
-- (unlike sessions_select/users_select): nobody else's users.read/
-- sessions.read/etc. holder has a legitimate reason to read another
-- account's MFA material, and application code never needs a cross-user
-- read path here (mfa.ts always scopes queries to the acting user's own id,
-- or to a userId already authorized by resolveSessionAuthz()/verifyStepUp()
-- during the pre-auth login-MFA step — see totp_credentials_select's second
-- branch below).
ALTER TABLE "totp_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recovery_codes" ENABLE ROW LEVEL SECURITY;

-- mfa_login_lookup: set ONLY by src/lib/mfa.ts's completeLoginMfa(), for the
-- one pre-full-session read/write this table needs — the caller is mid
-- login, already holds a real (but MFA-pending) app.user_id from
-- resolveSessionAuthz()'s zeroed snapshot, so this mirrors
-- app.password_reset_lookup/app.oauth_lookup's "narrow, named, pre-auth
-- carve-out" shape rather than trusting a bare "user_id = app.user_id"
-- branch to somehow distinguish a pending login from a fully verified one
-- (RLS has no notion of "verified" — that distinction is enforced in
-- application code, this flag just names the one query path allowed to run
-- before it).
CREATE POLICY totp_credentials_select ON "totp_credentials" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.mfa_login_lookup', true) = 'true'
);
CREATE POLICY totp_credentials_write ON "totp_credentials" FOR INSERT WITH CHECK (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY totp_credentials_update ON "totp_credentials" FOR UPDATE USING (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.mfa_login_lookup', true) = 'true'
) WITH CHECK (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.mfa_login_lookup', true) = 'true'
);
CREATE POLICY totp_credentials_delete ON "totp_credentials" FOR DELETE USING (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);

CREATE POLICY recovery_codes_select ON "recovery_codes" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.mfa_login_lookup', true) = 'true'
);
CREATE POLICY recovery_codes_write ON "recovery_codes" FOR INSERT WITH CHECK (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY recovery_codes_update ON "recovery_codes" FOR UPDATE USING (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.mfa_login_lookup', true) = 'true'
) WITH CHECK (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.mfa_login_lookup', true) = 'true'
);
CREATE POLICY recovery_codes_delete ON "recovery_codes" FOR DELETE USING (
  "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
