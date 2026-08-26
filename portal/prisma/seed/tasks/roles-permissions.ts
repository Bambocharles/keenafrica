import {
  ROLE_NAMES,
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type RoleName,
} from "@/lib/authz";
import type { SeedTask } from "../types";

const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: "Full platform access; bypasses permission checks entirely (isSuperAdmin flag).",
  ADMIN: "Manages users, roles, and platform security settings.",
  TROUBLESHOOTER: "Least-privilege diagnostic/security role: read + session revocation only.",
  TEACHER: "Creates and delivers course content to enrolled students.",
  STUDENT: "Enrolls in and completes courses.",
  SPONSOR_ADMIN: "Manages a sponsor organization's projects and users.",
  SPONSOR_USER: "Views a sponsor organization's projects.",
};

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [PERMISSIONS.USERS_READ]: "View user accounts.",
  [PERMISSIONS.USERS_CREATE]: "Create new user accounts.",
  [PERMISSIONS.USERS_UPDATE]: "Edit another user's profile.",
  [PERMISSIONS.USERS_SUSPEND]: "Suspend or reinstate a user account.",
  [PERMISSIONS.ROLES_MANAGE]: "Assign or remove roles on a user account.",
  [PERMISSIONS.SESSIONS_READ]: "View another user's active sessions.",
  [PERMISSIONS.SESSIONS_REVOKE]: "Revoke another user's session(s).",
  [PERMISSIONS.AUDIT_READ]: "Read the security/audit event log.",
  [PERMISSIONS.FLAGS_MANAGE]: "Toggle feature flags on/off.",
};

/**
 * Seeds the Role/Permission catalog and the RolePermission mapping from
 * src/lib/authz.ts's DEFAULT_ROLE_PERMISSIONS — that file is the single
 * source of truth; this task just materializes it. Fully reconciles
 * role_permissions (adds missing, removes stale) on every run so the DB
 * can never drift from the code-defined mapping — role_permissions is
 * schema-defining, not end-user data, so this is safe and desired
 * (contrast with user_roles, which end users/admins mutate at runtime via
 * assignRole()/removeRole() and which this task never touches).
 */
export const rolesPermissionsTask: SeedTask = {
  name: "roles-permissions",
  kind: "core",
  async run(prisma) {
    for (const key of ALL_PERMISSION_KEYS) {
      await prisma.permission.upsert({
        where: { key },
        update: { description: PERMISSION_DESCRIPTIONS[key] },
        create: { key, description: PERMISSION_DESCRIPTIONS[key] },
      });
    }

    for (const name of ROLE_NAMES) {
      await prisma.role.upsert({
        where: { name },
        update: { description: ROLE_DESCRIPTIONS[name] },
        create: { name, description: ROLE_DESCRIPTIONS[name] },
      });
    }

    const [roles, permissions] = await Promise.all([
      prisma.role.findMany(),
      prisma.permission.findMany(),
    ]);
    const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

    for (const name of ROLE_NAMES) {
      const roleId = roleIdByName.get(name)!;
      const desiredKeys = new Set(DEFAULT_ROLE_PERMISSIONS[name]);

      await prisma.rolePermission.deleteMany({
        where: {
          roleId,
          permissionId: { notIn: [...desiredKeys].map((k) => permissionIdByKey.get(k)!) },
        },
      });

      for (const key of desiredKeys) {
        const permissionId = permissionIdByKey.get(key)!;
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId } },
          update: {},
          create: { roleId, permissionId },
        });
      }
    }

    console.log(`[roles-permissions] ${ROLE_NAMES.length} role(s), ${ALL_PERMISSION_KEYS.length} permission(s) present.`);
  },
};
