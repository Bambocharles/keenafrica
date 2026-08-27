import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface RlsContext {
  userId?: string;
  isSuperAdmin?: boolean;
  /**
   * Resolved permission keys for this request (e.g. "sessions.revoke"),
   * from the Role/Permission model — see src/lib/authz.ts. RLS policies
   * test membership with jsonb `?`. Never a substitute for isSuperAdmin's
   * RLS bypass; this is the finer-grained layer on top of it.
   */
  permissions?: string[];
  /**
   * Set ONLY by the Auth.js authorize() callback, for the single
   * parameterized exact-email-match lookup that has to run before any
   * session exists. Never set this anywhere else.
   */
  authLookup?: boolean;
  /**
   * Set ONLY by src/lib/password-reset.ts, for the token-hash lookup/consume
   * that has to run before any session exists (the requester is identified
   * by a possession-proof token, not app.user_id). Never set this anywhere
   * else.
   */
  passwordResetLookup?: boolean;
  /**
   * Set ONLY by src/lib/rate-limit.ts (Session 16), for the pre-auth COUNT
   * of recent login-failure audit_events rows a login attempt needs to
   * evaluate before app.user_id exists. Never set this anywhere else.
   */
  rateLimitLookup?: boolean;
}

/**
 * Every RLS-scoped query must go through this. set_config(..., is_local=true)
 * only holds for the current transaction, so the session vars and the real
 * query have to run in the same $transaction() call, not as separate awaits.
 */
export async function withRls<T>(
  ctx: RlsContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
    await tx.$executeRaw`SELECT set_config('app.auth_lookup', ${String(!!ctx.authLookup)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', ${String(!!ctx.passwordResetLookup)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.rate_limit_lookup', ${String(!!ctx.rateLimitLookup)}, true)`;
    return fn(tx);
  });
}
