-- Session 03 (Admin): feature_flags was seeded super-admin-only write
-- (20260826120000_add_feature_flags), with Session 01's handoff explicitly
-- anticipating this session would add a `flags.manage`-permission-gated
-- admin screen over the same table rather than a parallel config store.
--
-- Only the UPDATE policy is widened — the admin UI built here only ever
-- toggles `enabled` on an existing row (src/lib/feature-flags.ts's
-- setFeatureFlag()); it never inserts or deletes flag rows (the flag *set*
-- is defined in code, per FEATURE_FLAGS, and materialized by the seed).
-- INSERT/DELETE stay super-admin-only, same as before.
DROP POLICY "feature_flags_update" ON "feature_flags";
CREATE POLICY feature_flags_update ON "feature_flags" FOR UPDATE USING (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'flags.manage'
) WITH CHECK (
  current_setting('app.is_super_admin', true) = 'true'
  OR coalesce(nullif(current_setting('app.permissions', true), ''), '[]')::jsonb ? 'flags.manage'
);
