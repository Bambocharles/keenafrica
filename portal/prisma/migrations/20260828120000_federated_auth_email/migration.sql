-- Session 19 (Federated Auth & Email) — Google OAuth alongside the existing
-- password (Credentials) provider. This repo's Auth.js setup has no
-- database adapter (Credentials + a custom "sessions" table, not next-auth's
-- own session/account model — see src/lib/auth.ts), so provider identity
-- linking is hand-rolled here rather than provided by next-auth: a new
-- "user_identities" table, keyed on the provider's stable subject/account id
-- (google's "sub"), never on email address alone.
--
-- "users.password_hash" becomes nullable: a user created via Google sign-in
-- has no password at all (never derive/store one from an OAuth token) —
-- src/lib/auth.ts's Credentials authorize() now treats a null hash as
-- "password login unavailable for this account" rather than crashing.
-- Every existing writer (createUser/registerUser/resetPassword/seed tasks)
-- is unaffected and still always sets a real hash.
--
-- New RLS session var: app.oauth_lookup — set ONLY by
-- src/lib/oauth-identity.ts's resolveGoogleSignIn(), for the one pre-auth
-- SELECT of "user_identities" by (provider, provider_account_id) (there is
-- no app.user_id yet at that point — the whole reason this lookup exists is
-- to find out who, if anyone, this is) and the accompanying INSERT when
-- that lookup creates a brand-new Google-only account (paired with
-- app.self_registration on the "users"/"user_roles" insert it also does —
-- same pre-auth carve-out convention as app.auth_lookup/
-- app.password_reset_lookup/app.rate_limit_lookup/app.org_invitation_lookup/
-- app.self_registration). Never set anywhere else. The OTHER path that
-- writes this table — an already-authenticated user self-service "connect
-- Google" from their profile — needs no new flag at all: it runs with a
-- real app.user_id already set, so the plain "user_id = app.user_id" branch
-- below covers it.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_account_id_key" ON "user_identities"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Row-Level Security -------------------------------------------------------

ALTER TABLE "user_identities" ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin/users.read (support/troubleshooting visibility into
-- which accounts have a linked provider identity, same "admin read access"
-- shape as sessions_select's users.read/sessions.read widening), the row's
-- own user (self — "which providers am I linked with"), or the one pre-auth
-- lookup app.oauth_lookup performs before any session/app.user_id exists.
--
-- WRITE (insert): super_admin, the row's own user linking a provider to
-- their OWN already-authenticated account (user_id = app.user_id — this is
-- exactly as safe as a user creating their own Session row, which already
-- works the same way), or app.oauth_lookup for the one brand-new-account
-- case (paired with app.self_registration's "users"/"user_roles" insert in
-- the same request).
--
-- No UPDATE policy — a linked identity's (provider, provider_account_id) is
-- immutable; nothing in this codebase ever changes one in place. No DELETE
-- policy either — "unlink a provider" is a future self-service feature, not
-- required by this session's acceptance criteria; flagged as a known
-- limitation in docs/FEDERATED_AUTH.md rather than half-built here.
CREATE POLICY "user_identities_select" ON "user_identities" FOR SELECT USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.oauth_lookup', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'users.read'
);
CREATE POLICY "user_identities_write" ON "user_identities" FOR INSERT WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.oauth_lookup', true) = 'true'
);
