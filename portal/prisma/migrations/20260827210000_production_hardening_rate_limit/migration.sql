-- Session 16 (Production Hardening): login brute-force rate limiting.
--
-- src/lib/rate-limit.ts needs to COUNT recent audit_events rows
-- (login.failed / login.denied_suspended / login.rate_limited) pre-auth —
-- there is no app.user_id yet at the point a login attempt is being
-- evaluated, same situation Session 02 already solved for the credentials
-- lookup itself (app.auth_lookup) and for password-reset token consumption
-- (app.password_reset_lookup). audit_events_select today only grants read
-- access to super_admin/audit.read holders (see identity_security_foundation),
-- so a plain pre-auth COUNT would return 0 rows and the rate limiter would
-- never actually trip.
--
-- New session var: app.rate_limit_lookup — set ONLY by
-- src/lib/rate-limit.ts, mirroring the auth_lookup/password_reset_lookup
-- convention exactly. Additive (permissive) policy: every previously
-- authorized SELECT path on audit_events is unaffected.
--
-- Scope note: like auth_lookup/password_reset_lookup, this grants read
-- access to the whole row set while the flag is set, not just a COUNT —
-- RLS cannot restrict by query shape. Safe because only the trusted
-- rate-limit module ever sets this flag, and it only ever runs a scoped
-- COUNT(*) query (src/lib/rate-limit.ts) — never exposed to end users.
CREATE POLICY audit_events_rate_limit_lookup_select ON "audit_events" FOR SELECT USING (
  current_setting('app.rate_limit_lookup', true) = 'true'
);
