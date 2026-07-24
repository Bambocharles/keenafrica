import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface RlsContext {
  userId?: string;
  isSuperAdmin?: boolean;
  /**
   * Set ONLY by the Auth.js authorize() callback, for the single
   * parameterized exact-email-match lookup that has to run before any
   * session exists. Never set this anywhere else.
   */
  authLookup?: boolean;
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
    await tx.$executeRaw`SELECT set_config('app.auth_lookup', ${String(!!ctx.authLookup)}, true)`;
    return fn(tx);
  });
}
