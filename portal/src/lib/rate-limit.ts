import { withRls } from "@/lib/rls";

/**
 * Login brute-force protection (Session 16 — Production Hardening).
 *
 * Backed by the existing audit_events table rather than a new table —
 * src/lib/auth.ts's authorize() already records login.failed/
 * login.denied_suspended there for every failed attempt (see below); this
 * module just counts them. Reusing the canonical audit log keeps this a
 * single source of truth for "what happened," works across every pod
 * (unlike an in-memory counter, which wouldn't be shared across the 2
 * replicas in k8s/portal-prod.yaml), and needs no new schema beyond one
 * narrow RLS policy (see the production_hardening_rate_limit migration).
 *
 * Two independent limits, both must pass:
 *  - Per-account (by actorId): only meaningful once the email resolves to
 *    a real user — an unknown email has no actorId to key on, so this
 *    limit does nothing for account-enumeration attempts. That's fine; the
 *    per-IP limit below covers exactly that case.
 *  - Per-IP: covers both credential stuffing against one account and
 *    email-spraying across many unknown/known accounts from one source.
 *
 * Deliberately generous thresholds — this is abuse protection, not a
 * precision lockout mechanism. A false positive here locks a real user out
 * of their own account for the rest of the window, which is worse than
 * letting a slow attacker keep guessing for a few more minutes.
 */

const LOGIN_FAILURE_ACTIONS = ["login.failed", "login.denied_suspended"];

export const LOGIN_ACCOUNT_WINDOW = { windowMs: 15 * 60 * 1000, maxAttempts: 10 };
export const LOGIN_IP_WINDOW = { windowMs: 15 * 60 * 1000, maxAttempts: 30 };

/** Exported for src/lib/mfa.ts's isMfaAttemptRateLimited() — same "count recent audit_events" mechanism, different action set. */
export async function countRecentAuditEvents(opts: {
  actions: string[];
  actorId?: string | null;
  ipAddress?: string | null;
  sinceMs: number;
}): Promise<number> {
  if (!opts.actorId && !opts.ipAddress) return 0;

  const since = new Date(Date.now() - opts.sinceMs);

  return withRls({ rateLimitLookup: true }, async (tx) => {
    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM audit_events
      WHERE action = ANY(${opts.actions})
        AND created_at >= ${since}
        AND (
          (${opts.actorId ?? null}::uuid IS NOT NULL AND actor_id = ${opts.actorId ?? null}::uuid)
          OR (${opts.ipAddress ?? null}::text IS NOT NULL AND ip_address = ${opts.ipAddress ?? null}::text)
        )
    `;
    return Number(rows[0]?.count ?? 0);
  });
}

export interface LoginRateLimitCheck {
  /** The user this login attempt resolved to, if the email matched an account. */
  userId?: string | null;
  ipAddress?: string | null;
}

/**
 * Call BEFORE comparing the password — a blocked attempt shouldn't pay the
 * bcrypt cost, and shouldn't distinguish "rate limited" from "wrong
 * password" in the response (both just fail the sign-in the same way).
 */
export async function isLoginRateLimited(check: LoginRateLimitCheck): Promise<boolean> {
  const [accountCount, ipCount] = await Promise.all([
    check.userId
      ? countRecentAuditEvents({
          actions: LOGIN_FAILURE_ACTIONS,
          actorId: check.userId,
          sinceMs: LOGIN_ACCOUNT_WINDOW.windowMs,
        })
      : Promise.resolve(0),
    check.ipAddress
      ? countRecentAuditEvents({
          actions: LOGIN_FAILURE_ACTIONS,
          ipAddress: check.ipAddress,
          sinceMs: LOGIN_IP_WINDOW.windowMs,
        })
      : Promise.resolve(0),
  ]);

  return accountCount >= LOGIN_ACCOUNT_WINDOW.maxAttempts || ipCount >= LOGIN_IP_WINDOW.maxAttempts;
}

/**
 * MFA & Account Security (Session 20) — same mechanism as the login limiter
 * above (count recent audit_events, no new table), applied to
 * mfa.login_failed/step_up.failed instead of login.failed/
 * login.denied_suspended. Per-account only: unlike a login attempt, an MFA/
 * step-up challenge always already has a real, authenticated actorId (the
 * account either passed its primary factor already, or is stepping up an
 * existing session) — there's no "unknown email" case to also rate-limit
 * by IP for.
 */
export const MFA_ATTEMPT_WINDOW = { windowMs: 15 * 60 * 1000, maxAttempts: 8 };

export async function isMfaAttemptRateLimited(userId: string): Promise<boolean> {
  const count = await countRecentAuditEvents({
    actions: ["mfa.login_failed", "step_up.failed"],
    actorId: userId,
    sinceMs: MFA_ATTEMPT_WINDOW.windowMs,
  });
  return count >= MFA_ATTEMPT_WINDOW.maxAttempts;
}
