-- Session 34 (Keen Africans). Core identity extension: email verification.
--
-- email_verified_at on "users" — denormalized onto the canonical User row,
-- same convention as is_super_admin/status (PLATFORM_CONTEXT.md's Shared
-- identity rule: one canonical User, not a parallel table per feature).
-- Nullable/unset for every pre-existing account; today only
-- src/lib/articles.ts's publishArticle() reads it (gating a self-registered
-- Keen African's first publish per this session's abuse-model decision).
--
-- email_verification_tokens mirrors password_reset_tokens exactly: single-
-- use, hashed, TTL'd, and needs a pre-auth RLS carve-out
-- (app.email_verification_lookup) for the same reason password_reset_lookup
-- exists — the token IS the proof of identity at the point it's consumed,
-- there is no app.user_id yet.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(6);

CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security — identical shape to password_reset_tokens_select/
-- write/update (identity_security_foundation migration).
ALTER TABLE "email_verification_tokens" ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_verification_tokens_select ON "email_verification_tokens" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.email_verification_lookup', true) = 'true'
);
CREATE POLICY email_verification_tokens_write ON "email_verification_tokens" FOR INSERT WITH CHECK (
  current_setting('app.email_verification_lookup', true) = 'true'
);
CREATE POLICY email_verification_tokens_update ON "email_verification_tokens" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.email_verification_lookup', true) = 'true'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR current_setting('app.email_verification_lookup', true) = 'true'
);
-- No DELETE policy — same append-only shape as password_reset_tokens.
