-- Session 37 (Keen Africans — Account & Security). Self-service, irreversible
-- account deletion (src/lib/users.ts's anonymizeOwnAccount()): the User row
-- is anonymized (name/email scrubbed, password cleared, status set to the
-- 'deleted' value the prior migration added), never hard-deleted —
-- users_delete stays super_admin-only, unchanged.
--
-- "anonymized_at" — when the anonymization ran, mirrors users.suspended_at's
-- existing shape.
ALTER TABLE "users" ADD COLUMN "anonymized_at" TIMESTAMPTZ(6);

-- "user_identities_delete" — the federated_auth_email migration deliberately
-- shipped with NO delete policy at all ("'unlink a provider' is a future
-- self-service feature... flagged as a known limitation" — see that
-- migration's own comment). Account deletion is exactly the case that
-- limitation blocks: without this policy, anonymizeOwnAccount()'s
-- tx.userIdentity.deleteMany() would silently affect zero rows under RLS,
-- leaving a deleted account's Google identity link live — someone could
-- sign back into the very account that was just anonymized via "Continue
-- with Google," reactivating it in every way that matters except the
-- (now-scrambled) email/password. Self-only, same shape as every other
-- self-scoped table in this codebase (profiles_write/update,
-- totp_credentials, recovery_codes, ...) — an outsider still can never
-- delete anyone else's linked identity, and super_admin retains the same
-- bypass every other policy in this codebase grants it.
CREATE POLICY "user_identities_delete" ON "user_identities" FOR DELETE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
);
