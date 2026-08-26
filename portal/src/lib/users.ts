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
