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
  /**
   * Organization Core (Session 17). Server-resolved JSON array of the
   * organization ids the caller holds an ACTIVE OrganizationMembership in
   * (any role) — resolved in src/lib/sessions.ts's resolveSessionAuthz(),
   * the same way roles/permissions already are, and NEVER trusted from a
   * client-supplied organization id. RLS policies test membership with a
   * jsonb_array_elements_text expression (see the organization_core
   * migration) since this is a set of ids, not a set of jsonb object keys
   * (unlike app.permissions' `?` key-existence test).
   */
  organizationIds?: string[];
  /**
   * Set ONLY by src/lib/organizations.ts's acceptOrganizationInvitation(),
   * for the token-authorized (not app.user_id/app.organization_ids
   * -authorized) invitation lookup/consume and the resulting
   * organization_memberships row it creates. Mirrors the existing
   * app.password_reset_lookup convention exactly. Never set this anywhere
   * else.
   */
  orgInvitationLookup?: boolean;
  /**
   * Set ONLY by src/lib/registration.ts's registerUser(), for the one
   * pre-auth INSERT into "users" (the new account) and its accompanying
   * "user_roles" row — there is no session/app.user_id yet at the point a
   * new self-registered account is being created. Never set this anywhere
   * else. See the self_registration migration's policy comments.
   */
  selfRegistration?: boolean;
  /**
   * Federated Auth (Session 19). Set ONLY by
   * src/lib/oauth-identity.ts's resolveGoogleSignIn(), for the pre-auth
   * lookup of "user_identities" by (provider, providerAccountId) — there is
   * no app.user_id yet at that point, same reasoning as authLookup — and
   * for the accompanying INSERT when that lookup results in a brand-new
   * Google-only account (paired with selfRegistration on the users/
   * user_roles insert in the same request). Never set anywhere else. A
   * self-service "connect Google to my already-authenticated account" link
   * needs no flag: it runs under a real app.user_id, covered by
   * user_identities_write's own "user_id = app.user_id" branch.
   */
  oauthLookup?: boolean;
  /**
   * MFA & Account Security (Session 20). Set ONLY by
   * src/lib/mfa.ts's completeLoginMfa(), for the narrow pre-full-session
   * read/write of "totp_credentials"/"recovery_codes" a login-time MFA
   * challenge needs — the caller already has a real (but MFA-pending)
   * app.user_id from resolveSessionAuthz()'s zeroed snapshot, same
   * "possession-proof, not yet fully authorized" shape as
   * app.password_reset_lookup/app.oauth_lookup. Never set anywhere else. A
   * self-service enroll/disable/regenerate action needs no flag: it runs
   * under a real, fully-verified app.user_id, covered by each table's own
   * "user_id = app.user_id" branch.
   */
  mfaLoginLookup?: boolean;
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
    await tx.$executeRaw`SELECT set_config('app.organization_ids', ${JSON.stringify(ctx.organizationIds ?? [])}, true)`;
    await tx.$executeRaw`SELECT set_config('app.org_invitation_lookup', ${String(!!ctx.orgInvitationLookup)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.self_registration', ${String(!!ctx.selfRegistration)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.oauth_lookup', ${String(!!ctx.oauthLookup)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.mfa_login_lookup', ${String(!!ctx.mfaLoginLookup)}, true)`;
    return fn(tx);
  });
}
