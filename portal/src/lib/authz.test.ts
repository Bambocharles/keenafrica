import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  PERMISSIONS,
  canAccessAdminConsole,
  canAccessTeacherPortal,
  canActOnOwnResource,
  hasPermission,
  requireOwnResourceOrPermission,
  requirePermission,
  type AuthzActor,
} from "./authz";

function actor(overrides: Partial<AuthzActor> = {}): AuthzActor {
  return { id: "user-1", isSuperAdmin: false, permissions: [], ...overrides };
}

describe("hasPermission", () => {
  it("is false for a null/undefined actor", () => {
    expect(hasPermission(null, PERMISSIONS.USERS_READ)).toBe(false);
    expect(hasPermission(undefined, PERMISSIONS.USERS_READ)).toBe(false);
  });

  it("is false when the actor lacks the permission", () => {
    expect(hasPermission(actor({ permissions: [PERMISSIONS.SESSIONS_READ] }), PERMISSIONS.USERS_READ)).toBe(
      false
    );
  });

  it("is true when the actor holds the permission", () => {
    expect(hasPermission(actor({ permissions: [PERMISSIONS.USERS_READ] }), PERMISSIONS.USERS_READ)).toBe(true);
  });

  it("is true for a super admin regardless of their permission list", () => {
    expect(hasPermission(actor({ isSuperAdmin: true, permissions: [] }), PERMISSIONS.ROLES_MANAGE)).toBe(true);
  });
});

describe("requirePermission", () => {
  it("throws AuthorizationError for no actor", () => {
    expect(() => requirePermission(null, PERMISSIONS.USERS_READ)).toThrow(AuthorizationError);
  });

  it("throws AuthorizationError when the permission is missing", () => {
    expect(() => requirePermission(actor(), PERMISSIONS.ROLES_MANAGE)).toThrow(AuthorizationError);
  });

  it("returns the actor when the permission is held", () => {
    const a = actor({ permissions: [PERMISSIONS.ROLES_MANAGE] });
    expect(requirePermission(a, PERMISSIONS.ROLES_MANAGE)).toBe(a);
  });

  it("does not throw for a super admin even with an empty permission list", () => {
    expect(() => requirePermission(actor({ isSuperAdmin: true }), PERMISSIONS.AUDIT_READ)).not.toThrow();
  });
});

describe("canActOnOwnResource / requireOwnResourceOrPermission", () => {
  it("allows the resource owner without any permission grant", () => {
    const a = actor({ id: "user-1", permissions: [] });
    expect(canActOnOwnResource(a, "user-1", PERMISSIONS.SESSIONS_REVOKE)).toBe(true);
    expect(() => requireOwnResourceOrPermission(a, "user-1", PERMISSIONS.SESSIONS_REVOKE)).not.toThrow();
  });

  it("denies a non-owner without the permission — the core negative authorization case", () => {
    const a = actor({ id: "user-1", permissions: [] });
    expect(canActOnOwnResource(a, "user-2", PERMISSIONS.SESSIONS_REVOKE)).toBe(false);
    expect(() => requireOwnResourceOrPermission(a, "user-2", PERMISSIONS.SESSIONS_REVOKE)).toThrow(
      AuthorizationError
    );
  });

  it("allows a non-owner who holds the permission", () => {
    const a = actor({ id: "user-1", permissions: [PERMISSIONS.SESSIONS_REVOKE] });
    expect(canActOnOwnResource(a, "user-2", PERMISSIONS.SESSIONS_REVOKE)).toBe(true);
  });
});

describe("canAccessAdminConsole — the admin-console-shell entry gate", () => {
  it("is false for no session", () => {
    expect(canAccessAdminConsole(null)).toBe(false);
    expect(canAccessAdminConsole(undefined)).toBe(false);
  });

  it("is false for a role with no admin-console standing (e.g. TEACHER/STUDENT)", () => {
    expect(canAccessAdminConsole({ isSuperAdmin: false, roles: ["TEACHER"] })).toBe(false);
    expect(canAccessAdminConsole({ isSuperAdmin: false, roles: ["STUDENT", "SPONSOR_USER"] })).toBe(false);
    expect(canAccessAdminConsole({ isSuperAdmin: false, roles: [] })).toBe(false);
  });

  it("is true for ADMIN or TROUBLESHOOTER even without isSuperAdmin", () => {
    expect(canAccessAdminConsole({ isSuperAdmin: false, roles: ["ADMIN"] })).toBe(true);
    expect(canAccessAdminConsole({ isSuperAdmin: false, roles: ["TROUBLESHOOTER"] })).toBe(true);
  });

  it("is true for isSuperAdmin regardless of role labels", () => {
    expect(canAccessAdminConsole({ isSuperAdmin: true, roles: [] })).toBe(true);
  });
});

describe("canAccessTeacherPortal — the teacher-workspace-shell entry gate (Session 05)", () => {
  it("is false for no session", () => {
    expect(canAccessTeacherPortal(null)).toBe(false);
    expect(canAccessTeacherPortal(undefined)).toBe(false);
  });

  it("is false for a role with no teacher-workspace standing (e.g. STUDENT/ADMIN)", () => {
    expect(canAccessTeacherPortal({ isSuperAdmin: false, roles: ["STUDENT"] })).toBe(false);
    expect(canAccessTeacherPortal({ isSuperAdmin: false, roles: ["ADMIN"] })).toBe(false);
    expect(canAccessTeacherPortal({ isSuperAdmin: false, roles: [] })).toBe(false);
  });

  it("is true for TEACHER", () => {
    expect(canAccessTeacherPortal({ isSuperAdmin: false, roles: ["TEACHER"] })).toBe(true);
  });

  it("is true for isSuperAdmin regardless of role labels", () => {
    expect(canAccessTeacherPortal({ isSuperAdmin: true, roles: [] })).toBe(true);
  });
});
