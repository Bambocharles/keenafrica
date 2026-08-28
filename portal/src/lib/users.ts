import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { withRls } from "@/lib/rls";
import {
  PERMISSIONS,
  ROLE_NAMES,
  requirePermission,
  requireOwnResourceOrPermission,
  type AuthzActor,
  type RoleName,
} from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { revokeAllUserSessionsAsSystem } from "@/lib/sessions";
import { emitDomainEvent } from "@/lib/events";
import { requireStepUp } from "@/lib/mfa";

const MIN_PASSWORD_LENGTH = 8; // matches registration.ts's weak_password threshold.
const BCRYPT_COST = 12; // matches registration.ts/password-reset.ts.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

function actorRlsCtx(actor: AuthzActor) {
  return { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] };
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roles: RoleName[];
}

/**
 * Canonical user-creation entry point — the contract other sessions
 * (Admin inviting an admin/teacher, Sponsor inviting a sponsor user, ...)
 * should call rather than writing their own `prisma.user.create`. Requires
 * users.create. Every created user must have at least one role — there is
 * no "roleless" account.
 */
export async function createUser(input: CreateUserInput, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.USERS_CREATE);
  if (input.roles.length === 0) {
    throw new Error("At least one role is required");
  }
  for (const r of input.roles) {
    if (!ROLE_NAMES.includes(r)) throw new Error(`Unknown role: ${r}`);
  }

  const passwordHash = await hash(input.password, 12);

  const user = await withRls(actorRlsCtx(actor), async (tx) => {
    const roleRows = await tx.role.findMany({ where: { name: { in: input.roles } } });
    if (roleRows.length !== input.roles.length) {
      throw new Error("One or more roles are not seeded yet");
    }

    const created = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        userRoles: {
          create: roleRows.map((r) => ({ roleId: r.id })),
        },
      },
      select: { id: true, email: true, name: true },
    });
    return created;
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "user.created",
    entityType: "User",
    entityId: user.id,
    metadata: { roles: input.roles },
  });
  emitDomainEvent("UserCreated", { userId: user.id });

  return user;
}

export interface UpdateUserProfileInput {
  name: string;
}

/** Self, super_admin, or users.update holders. */
export async function updateUserProfile(
  targetUserId: string,
  data: UpdateUserProfileInput,
  actor: AuthzActor
) {
  requireOwnResourceOrPermission(actor, targetUserId, PERMISSIONS.USERS_UPDATE);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.update({ where: { id: targetUserId }, data: { name: data.name } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "user.profile_updated",
    entityType: "User",
    entityId: targetUserId,
  });
}

/**
 * MFA & Account Security (Session 20) — self-service "change my password"
 * for an already-authenticated user. Distinct from Session 02's
 * requestPasswordReset()/resetPassword() (the pre-auth "forgot password"
 * token flow, unaffected — still the only path for someone who's actually
 * locked out) and from the admin console's triggerPasswordResetAction
 * (an admin acting on SOMEONE ELSE's account). Always requires a fresh
 * step-up proof — the whole point of this action is changing the account's
 * primary credential, so it never accepts the caller's word alone.
 * Revokes every other session, same as a token-based reset — an
 * already-authenticated attacker's stolen session shouldn't survive their
 * victim changing the password out from under them.
 */
export async function changeOwnPassword(actor: AuthzActor, newPassword: string): Promise<void> {
  await requireStepUp(actor);
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error("weak_password");
  }

  const passwordHash = await hash(newPassword, BCRYPT_COST);
  await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.update({ where: { id: actor.id }, data: { passwordHash } })
  );

  await revokeAllUserSessionsAsSystem(actor.id, actor.id);

  await recordAuditEvent({
    actorId: actor.id,
    action: "user.password_changed",
    entityType: "User",
    entityId: actor.id,
  });
}

/**
 * MFA & Account Security (Session 20) — self-service "change my email."
 * Same step-up requirement and reasoning as changeOwnPassword() above. No
 * confirmation-email verification step (this codebase has never built one
 * — self-registration doesn't verify email either, see registration.ts) —
 * flagged as a known limitation, not silently assumed away.
 */
export async function changeOwnEmail(actor: AuthzActor, newEmail: string): Promise<void> {
  await requireStepUp(actor);
  const email = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error("invalid_input");
  }

  try {
    await withRls(actorRlsCtx(actor), (tx) => tx.user.update({ where: { id: actor.id }, data: { email } }));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error("email_taken");
    }
    throw err;
  }

  await recordAuditEvent({
    actorId: actor.id,
    action: "user.email_changed",
    entityType: "User",
    entityId: actor.id,
  });
}

/**
 * Suspension is intentionally NOT self-servable, even by an admin acting
 * on their own account — always requires users.suspend explicitly, never
 * the self-ownership bypass other user-facing actions get. Revokes every
 * active session so the block takes effect immediately, not just on next
 * login.
 */
export async function suspendUser(targetUserId: string, actor: AuthzActor, reason?: string) {
  requirePermission(actor, PERMISSIONS.USERS_SUSPEND);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { status: "suspended", suspendedAt: new Date() },
    })
  );

  await revokeAllUserSessionsAsSystem(targetUserId, actor.id);

  await recordAuditEvent({
    actorId: actor.id,
    action: "user.suspended",
    entityType: "User",
    entityId: targetUserId,
    metadata: reason ? { reason } : undefined,
  });
  emitDomainEvent("UserSuspended", { userId: targetUserId, actorId: actor.id });
}

export async function reinstateUser(targetUserId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.USERS_SUSPEND);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { status: "active", suspendedAt: null },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "user.reinstated",
    entityType: "User",
    entityId: targetUserId,
  });
}

/**
 * MFA & Account Security (Session 20) — SUPER_ADMIN/ADMIN are the
 * platform's privileged global roles; granting either is a sensitive
 * action ("assign privileged roles" — sessions/20-mfa-account-security.md)
 * and requires a fresh step-up proof from the actor doing the granting,
 * regardless of what permission they already hold. TEACHER, STUDENT,
 * SPONSOR_ADMIN, SPONSOR_USER, and TROUBLESHOOTER are not gated here —
 * assigning those is routine admin work, not a privilege escalation in the
 * same sense.
 */
const PRIVILEGED_ROLES: readonly RoleName[] = ["SUPER_ADMIN", "ADMIN"];

/** Requires roles.manage — assigns an existing role to a user (idempotent). */
export async function assignRole(targetUserId: string, roleName: RoleName, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.ROLES_MANAGE);
  if (PRIVILEGED_ROLES.includes(roleName)) {
    await requireStepUp(actor);
  }

  await withRls(actorRlsCtx(actor), async (tx) => {
    const role = await tx.role.findUnique({ where: { name: roleName } });
    if (!role) throw new Error(`Unknown role: ${roleName}`);
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: targetUserId, roleId: role.id } },
      create: { userId: targetUserId, roleId: role.id },
      update: {},
    });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "role.assigned",
    entityType: "User",
    entityId: targetUserId,
    metadata: { role: roleName },
  });
  emitDomainEvent("RoleChanged", { userId: targetUserId, actorId: actor.id });
}

/** Requires roles.manage — removes a role from a user (idempotent). */
export async function removeRole(targetUserId: string, roleName: RoleName, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.ROLES_MANAGE);

  await withRls(actorRlsCtx(actor), async (tx) => {
    const role = await tx.role.findUnique({ where: { name: roleName } });
    if (!role) throw new Error(`Unknown role: ${roleName}`);
    await tx.userRole.deleteMany({ where: { userId: targetUserId, roleId: role.id } });
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "role.removed",
    entityType: "User",
    entityId: targetUserId,
    metadata: { role: roleName },
  });
  emitDomainEvent("RoleChanged", { userId: targetUserId, actorId: actor.id });
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  status: "active" | "suspended";
  isSuperAdmin: boolean;
  roles: string[];
  createdAt: Date;
  suspendedAt: Date | null;
}

export interface ListUsersFilter {
  /** Filter to users holding this role. Omit for every role. */
  role?: RoleName;
  status?: "active" | "suspended";
  /** Case-insensitive substring match against name or email. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  users: UserSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Admin console's user directory (Session 03) — search/filter/pagination
 * over the canonical User table, built on top of Session 02's Role/
 * Permission model. Requires users.read; this is a read surface, so no
 * ownership bypass (contrast with updateUserProfile/listSessions) — an
 * unprivileged caller has no legitimate reason to enumerate every account.
 */
export async function listUsers(filter: ListUsersFilter, actor: AuthzActor): Promise<ListUsersResult> {
  requirePermission(actor, PERMISSIONS.USERS_READ);

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = filter.search?.trim();

  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.role ? { userRoles: { some: { role: { name: filter.role } } } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { rows, total } = await withRls(actorRlsCtx(actor), async (tx) => {
    const [rows, total] = await Promise.all([
      tx.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          isSuperAdmin: true,
          createdAt: true,
          suspendedAt: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
      }),
      tx.user.count({ where }),
    ]);
    return { rows, total };
  });

  return {
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      isSuperAdmin: u.isSuperAdmin,
      roles: u.userRoles.map((ur) => ur.role.name),
      createdAt: u.createdAt,
      suspendedAt: u.suspendedAt,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Self-scoped profile read — no permission required, since the target is
 * always the caller's own id (never a parameter an attacker could swap).
 * Fills the gap Session 03's handoff flagged: getUserById()/listUsers() are
 * gated on users.read with no ownership bypass, which every
 * ADMIN_CONSOLE_ROLES role holds but a plain TEACHER/STUDENT does not — a
 * teacher self-editing their own display name still needs a fresh read of
 * their own row (the JWT session's `name` claim is set at login and never
 * refreshed, unlike roles/permissions/isSuperAdmin — see auth.ts's jwt
 * callback), and users.read is the wrong permission to require for that.
 */
export async function getOwnProfile(actor: AuthzActor): Promise<{ id: string; email: string; name: string } | null> {
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, name: true } })
  );
}

/** Requires users.read. Returns null if the user doesn't exist. */
export async function getUserById(targetUserId: string, actor: AuthzActor): Promise<UserSummary | null> {
  requirePermission(actor, PERMISSIONS.USERS_READ);

  const u = await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isSuperAdmin: true,
        createdAt: true,
        suspendedAt: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    })
  );
  if (!u) return null;

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    isSuperAdmin: u.isSuperAdmin,
    roles: u.userRoles.map((ur) => ur.role.name),
    createdAt: u.createdAt,
    suspendedAt: u.suspendedAt,
  };
}
