import { withRls } from "@/lib/rls";
import { PERMISSIONS, requireOwnResourceOrPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";

// Must match NextAuth's `session.maxAge` in src/lib/auth.ts (left at the
// library default: 30 days) — this is the DB row's independent expiry,
// checked every request by resolveSessionAuthz(), not derived from the JWT.
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreateSessionInput {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  ttlMs?: number;
  /**
   * MFA & Account Security (Session 20) — decided by the caller (auth.ts's
   * authorize()/signIn callback) via src/lib/mfa.ts's
   * shouldRequireLoginMfa() BEFORE this call, never re-derived here. When
   * true, resolveSessionAuthz() zeroes out roles/permissions/isSuperAdmin
   * for this session until mfa_verified_at is set (src/lib/mfa.ts's
   * completeLoginMfa()). Defaults false — every pre-Session-20 call site
   * (tests included) is unaffected.
   */
  mfaRequired?: boolean;
}

/**
 * Called once, from the Credentials authorize() callback, on successful
 * login. The row's id is what the JWT carries forward (token.sessionId) —
 * the JWT never carries authorization state that isn't re-validated here
 * against this table on every subsequent request.
 */
export async function createSession(input: CreateSessionInput): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS));
  const session = await withRls({ userId: input.userId }, (tx) =>
    tx.session.create({
      data: {
        userId: input.userId,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        expiresAt,
        mfaRequired: input.mfaRequired ?? false,
      },
      select: { id: true, expiresAt: true },
    })
  );
  return session;
}

export interface AuthzSnapshot {
  isSuperAdmin: boolean;
  status: "active" | "suspended";
  roles: string[];
  permissions: string[];
  /** Organization Core (Session 17) — organization ids the user holds an ACTIVE membership in. */
  organizationIds: string[];
  /**
   * MFA & Account Security (Session 20) — true when this session still
   * requires a second factor before it's fully authorized. While true,
   * isSuperAdmin/roles/permissions/organizationIds above are all zeroed
   * out (not merely hidden by the UI) — see this function's body. A
   * pending session can pass every OTHER check (valid, unexpired,
   * unrevoked, account not suspended) yet still carry zero real
   * capability, so every requirePermission()/canAccess*Portal() call
   * anywhere in the app fails closed until src/lib/mfa.ts's
   * completeLoginMfa() clears it.
   */
  mfaPending: boolean;
}

/**
 * The per-request revocation + authorization check. Called from the jwt
 * callback (src/lib/auth.ts) on EVERY request that touches a session, not
 * just at sign-in — that's what makes a JWT-strategy session actually
 * revocable: the token only ever carries a session id, this function is
 * the source of truth for whether that id is still good.
 *
 * Returns null when the session must be treated as invalid right now:
 * the row is missing/revoked/expired, or the user account is suspended.
 * The caller (jwt callback) turns a null return into killing the token.
 */
export async function resolveSessionAuthz(
  sessionId: string,
  userId: string
): Promise<AuthzSnapshot | null> {
  return withRls({ userId }, async (tx) => {
    const session = await tx.session.findFirst({
      where: { id: sessionId, userId },
      select: { revokedAt: true, expiresAt: true, mfaRequired: true, mfaVerifiedAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true, status: true },
    });
    if (!user || user.status === "suspended") {
      return null;
    }

    // MFA & Account Security (Session 20) — a session that still owes its
    // second factor is valid (not revoked/expired, account not suspended)
    // but carries NO capability at all until mfa_verified_at is set. This
    // is the actual enforcement point: every requirePermission()/
    // canAccess*Portal() check downstream sees isSuperAdmin=false and empty
    // roles/permissions, so there is no route or Server Action anywhere in
    // the app a pending session can reach beyond the MFA challenge itself —
    // enforced here, server-side, on every request, not left to page-level
    // redirects to get right.
    if (session.mfaRequired && !session.mfaVerifiedAt) {
      return {
        isSuperAdmin: false,
        status: user.status,
        roles: [],
        permissions: [],
        organizationIds: [],
        mfaPending: true,
      };
    }

    const userRoles = await tx.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            name: true,
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)))
    );

    // Organization Core (Session 17) — resolved server-side, the same way
    // roles/permissions are, and re-checked on every request exactly like
    // them (see this function's own docstring): an org membership change
    // takes effect on the target's very next request, not at next login.
    // Self-row read only (organization_memberships_select's "user_id = self"
    // branch) — no recursion, no dependency on app.organization_ids itself.
    const orgMemberships = await tx.organizationMembership.findMany({
      where: { userId, status: "active" },
      select: { organizationId: true },
    });
    const organizationIds = orgMemberships.map((m) => m.organizationId);

    return {
      isSuperAdmin: user.isSuperAdmin,
      status: user.status,
      roles,
      permissions,
      organizationIds,
      mfaPending: false,
    };
  });
}

async function actorFor(actor: AuthzActor) {
  return { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] };
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Lists a user's sessions. Self, super_admin, or sessions.read holders. */
export async function listSessions(targetUserId: string, actor: AuthzActor): Promise<SessionSummary[]> {
  requireOwnResourceOrPermission(actor, targetUserId, PERMISSIONS.SESSIONS_READ);
  return withRls(await actorFor(actor), (tx) =>
    tx.session.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: "desc" },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true, revokedAt: true },
    })
  );
}

/** Revokes one session. Self (its owner), super_admin, or sessions.revoke holders. */
export async function revokeSession(sessionId: string, actor: AuthzActor): Promise<void> {
  const session = await withRls(await actorFor(actor), (tx) =>
    tx.session.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, revokedAt: true } })
  );
  if (!session) throw new Error("Session not found");
  requireOwnResourceOrPermission(actor, session.userId, PERMISSIONS.SESSIONS_REVOKE);
  if (session.revokedAt) return; // already revoked — idempotent

  await withRls(await actorFor(actor), (tx) =>
    tx.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedBy: actor.id },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "session.revoked",
    entityType: "Session",
    entityId: sessionId,
    metadata: { targetUserId: session.userId },
  });
}

async function revokeAllSessionsUnchecked(
  targetUserId: string,
  rlsCtx: { userId: string; isSuperAdmin?: boolean; permissions: string[] },
  revokedBy: string
): Promise<number> {
  const result = await withRls(rlsCtx, (tx) =>
    tx.session.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy },
    })
  );

  if (result.count > 0) {
    await recordAuditEvent({
      actorId: revokedBy,
      action: "session.revoked_all",
      entityType: "User",
      entityId: targetUserId,
      metadata: { count: result.count },
    });
  }
  return result.count;
}

/**
 * Revokes every active session for a user. Self, super_admin, or
 * sessions.revoke holders — e.g. a "log out all my devices" self-service
 * action, or a troubleshooter/admin killing a compromised account's
 * sessions directly.
 */
export async function revokeAllUserSessions(targetUserId: string, actor: AuthzActor): Promise<number> {
  requireOwnResourceOrPermission(actor, targetUserId, PERMISSIONS.SESSIONS_REVOKE);
  return revokeAllSessionsUnchecked(targetUserId, await actorFor(actor), actor.id);
}

/**
 * For use ONLY by other trusted server-side lib functions (e.g.
 * suspendUser(), resetPassword()) that have already authorized their own,
 * broader action and need session revocation as a necessary side effect of
 * it — not a caller-facing API. Deliberately grants exactly
 * sessions.revoke for this one mutation rather than trusting the caller's
 * full permission set, so it can't be mistaken for a general-purpose
 * escalation.
 */
export async function revokeAllUserSessionsAsSystem(
  targetUserId: string,
  causedByUserId: string
): Promise<number> {
  return revokeAllSessionsUnchecked(
    targetUserId,
    { userId: causedByUserId, permissions: [PERMISSIONS.SESSIONS_REVOKE] },
    causedByUserId
  );
}

// --- Step-up authentication (Session 20) -----------------------------------
//
// "Step-up" is a short-lived freshness marker on this SAME sessions row
// (step_up_verified_at) — not a new token/cookie/session concept. Always
// self-scoped: a caller only ever reads/writes their own current session's
// freshness, via the sessionId already resolved server-side onto
// session.user.sessionId (src/types/next-auth.d.ts) — never a
// client-suppliable id. src/lib/mfa.ts's requireStepUp()/verifyStepUp() are
// the actual gate other lib functions call; these two are just the
// narrow read/write primitives against the sessions table, kept here so
// every access to a Session row's columns stays in one file.

/** How long a step-up proof stays fresh before a sensitive action requires re-verification. */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

/** True iff this session (still valid, unrevoked, unexpired) proved its current factor within STEP_UP_WINDOW_MS. */
export async function isStepUpFresh(sessionId: string, userId: string): Promise<boolean> {
  const session = await withRls({ userId }, (tx) =>
    tx.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: { stepUpVerifiedAt: true, expiresAt: true },
    })
  );
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.stepUpVerifiedAt) {
    return false;
  }
  return Date.now() - session.stepUpVerifiedAt.getTime() < STEP_UP_WINDOW_MS;
}

/**
 * Marks this session as having just re-proven its current factor. Called
 * only after src/lib/mfa.ts has already independently verified a
 * password/TOTP/recovery-code credential — never call this without a
 * verification having just succeeded.
 */
export async function markSessionSteppedUp(
  sessionId: string,
  userId: string,
  opts: { alsoMfaVerified?: boolean } = {}
): Promise<void> {
  const now = new Date();
  const result = await withRls({ userId }, (tx) =>
    tx.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: {
        stepUpVerifiedAt: now,
        ...(opts.alsoMfaVerified ? { mfaVerifiedAt: now } : {}),
      },
    })
  );
  if (result.count === 0) {
    throw new Error("Session not found or no longer active");
  }
}

/** Exposed for the seed/tests that need to reason about default TTL. */
export { DEFAULT_SESSION_TTL_MS };
