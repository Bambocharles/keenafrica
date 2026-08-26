/**
 * Roles/permissions contract — Session 02 (Identity & Security).
 *
 * isSuperAdmin (on User, and as the RLS bypass in every table's policies)
 * is unchanged and remains the root escape hatch. Role/Permission is an
 * additive, finer-grained layer on top of it for non-super-admin actors
 * (ADMIN, TROUBLESHOOTER, TEACHER, STUDENT, SPONSOR_ADMIN, SPONSOR_USER).
 * A super admin implicitly holds every permission below regardless of any
 * Role row — see hasPermission().
 */

export const ROLE_NAMES = [
  "SUPER_ADMIN",
  "ADMIN",
  "TROUBLESHOOTER",
  "TEACHER",
  "STUDENT",
  "SPONSOR_ADMIN",
  "SPONSOR_USER",
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * Action-oriented permission keys, per PLATFORM_ARCHITECTURE.md §6. Only
 * keys for capabilities that exist *today* are seeded — Education/Sponsor
 * Core permissions (courses.*, assessments.*, sponsor.*) belong to the
 * sessions that build those entities, added the same way: extend this
 * list + the role_permissions seed, never a parallel permission table.
 */
export const PERMISSIONS = {
  USERS_READ: "users.read",
  USERS_CREATE: "users.create",
  USERS_UPDATE: "users.update",
  USERS_SUSPEND: "users.suspend",
  ROLES_MANAGE: "roles.manage",
  SESSIONS_READ: "sessions.read",
  SESSIONS_REVOKE: "sessions.revoke",
  AUDIT_READ: "audit.read",
  // Added by Session 03 (Admin) — Session 01's feature_flags table shipped
  // super-admin-only write with this key explicitly anticipated for the
  // admin UI over it (see docs/FEATURE_FLAGS.md "Toggling a flag today").
  FLAGS_MANAGE: "flags.manage",
} as const;
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS);

/**
 * Least-privilege default role -> permission map, seeded by
 * prisma/seed/tasks/roles-permissions.ts. TEACHER/STUDENT/SPONSOR_ADMIN/
 * SPONSOR_USER intentionally get none of these — they'll get their own
 * domain permissions (courses.*, sponsor.*, ...) from the sessions that
 * own those entities.
 *
 * TROUBLESHOOTER is deliberately narrower than ADMIN: read + session
 * revocation for diagnostics/incident response, never users.update/
 * users.suspend/roles.manage. Matches sessions/02-identity-security.md's
 * "Troubleshooters get only least-privilege diagnostic/security
 * capabilities."
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  ADMIN: ALL_PERMISSION_KEYS,
  TROUBLESHOOTER: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.SESSIONS_READ,
    PERMISSIONS.SESSIONS_REVOKE,
    PERMISSIONS.AUDIT_READ,
  ],
  TEACHER: [],
  STUDENT: [],
  SPONSOR_ADMIN: [],
  SPONSOR_USER: [],
};

/**
 * Roles that may reach the admin console shell at all
 * (`src/app/admin/(protected)/layout.tsx`). This is the coarse "can see the
 * console" gate only — every page/action inside still enforces its own
 * requirePermission()/requireOwnResourceOrPermission() check, per
 * CLAUDE_BUILD_RULES.md §5 ("a user must not gain access merely because a
 * UI route is hidden"). TROUBLESHOOTER is intentionally included here (it's
 * a diagnostic console role) even though it holds far fewer permissions
 * than ADMIN.
 */
export const ADMIN_CONSOLE_ROLES: readonly RoleName[] = ["SUPER_ADMIN", "ADMIN", "TROUBLESHOOTER"];

/** The minimal shape a session needs for the admin-console entry check. */
export interface AdminConsoleActor {
  isSuperAdmin: boolean;
  roles: readonly string[];
}

export function canAccessAdminConsole(actor: AdminConsoleActor | null | undefined): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.roles.some((r) => (ADMIN_CONSOLE_ROLES as readonly string[]).includes(r));
}

/** The minimal shape any caller (session.user, a test fixture) needs. */
export interface AuthzActor {
  id: string;
  isSuperAdmin: boolean;
  permissions: readonly string[];
}

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasPermission(actor: AuthzActor | null | undefined, key: PermissionKey): boolean {
  if (!actor) return false;
  return actor.isSuperAdmin || actor.permissions.includes(key);
}

/** Throws AuthorizationError when the actor lacks the permission. */
export function requirePermission(actor: AuthzActor | null | undefined, key: PermissionKey): AuthzActor {
  if (!actor) throw new AuthorizationError("Not authenticated");
  if (!hasPermission(actor, key)) {
    throw new AuthorizationError(`Missing permission: ${key}`);
  }
  return actor;
}

/** True when the actor is the resource owner OR holds the permission. */
export function canActOnOwnResource(
  actor: AuthzActor | null | undefined,
  resourceOwnerId: string,
  key: PermissionKey
): boolean {
  if (!actor) return false;
  return actor.id === resourceOwnerId || hasPermission(actor, key);
}

/** Throws AuthorizationError unless the actor owns the resource or holds the permission. */
export function requireOwnResourceOrPermission(
  actor: AuthzActor | null | undefined,
  resourceOwnerId: string,
  key: PermissionKey
): AuthzActor {
  if (!actor) throw new AuthorizationError("Not authenticated");
  if (!canActOnOwnResource(actor, resourceOwnerId, key)) {
    throw new AuthorizationError(`Missing permission: ${key}`);
  }
  return actor;
}
