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
      select: { revokedAt: true, expiresAt: true },
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

    return { isSuperAdmin: user.isSuperAdmin, status: user.status, roles, permissions };
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

/** Exposed for the seed/tests that need to reason about default TTL. */
export { DEFAULT_SESSION_TTL_MS };
