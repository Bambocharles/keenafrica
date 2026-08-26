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

/** Requires roles.manage — assigns an existing role to a user (idempotent). */
export async function assignRole(targetUserId: string, roleName: RoleName, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.ROLES_MANAGE);

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
