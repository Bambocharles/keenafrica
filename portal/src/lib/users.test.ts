import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { createSession, resolveSessionAuthz } from "@/lib/sessions";
import {
  assignRole,
  createUser,
  getUserById,
  listUsers,
  reinstateUser,
  removeRole,
  suspendUser,
  updateUserProfile,
} from "@/lib/users";
import { actorFromUser, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}
function trackCreated(id: string) {
  createdUserIds.push(id);
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

describe("createUser — authorization boundary", () => {
  it("requires users.create", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(
      createUser(
        { email: `blocked-${Date.now()}@example.com`, name: "Blocked", password: "x", roles: ["STUDENT"] },
        strangerActor
      )
    ).rejects.toThrow(AuthorizationError);
  });

  it("an admin can create a user, who is created with the requested role and emits UserCreated + an audit event", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const email = `created-${Date.now()}@example.com`;

    const created = await createUser({ email, name: "New Teacher", password: "x", roles: ["TEACHER"] }, adminActor);
    trackCreated(created.id);

    const roles = await prisma.userRole.findMany({ where: { userId: created.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(["TEACHER"]);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "user.created", entityId: created.id } });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(admin.id);
  });

  it("rejects creating a user with zero roles", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    await expect(
      createUser({ email: `noroles-${Date.now()}@example.com`, name: "X", password: "x", roles: [] }, adminActor)
    ).rejects.toThrow(/role/i);
  });
});

describe("updateUserProfile — authorization boundary", () => {
  it("the user can update their own profile", async () => {
    const u = await user();
    const actor = await actorFromUser(u.id);

    await updateUserProfile(u.id, { name: "New Name" }, actor);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.name).toBe("New Name");
  });

  it("a stranger without users.update cannot edit someone else's profile", async () => {
    const owner = await user();
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(updateUserProfile(owner.id, { name: "Hijacked" }, strangerActor)).rejects.toThrow(
      AuthorizationError
    );

    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.name).not.toBe("Hijacked");
  });

  it("a users.update holder can edit another user's profile", async () => {
    const owner = await user();
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);

    await updateUserProfile(owner.id, { name: "Edited By Admin" }, adminActor);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.name).toBe("Edited By Admin");
  });
});

describe("suspendUser / reinstateUser — the account-suspension acceptance criterion", () => {
  it("is NOT self-servable — a user cannot suspend/reinstate their own account via the ownership bypass", async () => {
    const u = await user();
    const actor = await actorFromUser(u.id);

    await expect(suspendUser(u.id, actor)).rejects.toThrow(AuthorizationError);
  });

  it("a stranger without users.suspend cannot suspend another user", async () => {
    const owner = await user();
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(suspendUser(owner.id, strangerActor)).rejects.toThrow(AuthorizationError);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.status).toBe("active");
  });

  it("an admin suspending a user sets status=suspended, revokes every active session, and audits + emits UserSuspended", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const target = await user();
    const session = await createSession({ userId: target.id });

    await suspendUser(target.id, adminActor, "policy violation");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("suspended");
    expect(row.suspendedAt).not.toBeNull();

    // The suspension must take effect immediately, not just on next login —
    // this is the actual enforcement mechanism (see auth.ts's jwt callback).
    expect(await resolveSessionAuthz(session.id, target.id)).toBeNull();

    const sessionRow = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionRow.revokedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findFirst({ where: { action: "user.suspended", entityId: target.id } });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toEqual({ reason: "policy violation" });
  });

  it("reinstateUser clears suspension and restores login eligibility", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const target = await user({ status: "suspended" });

    await reinstateUser(target.id, adminActor);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("active");
    expect(row.suspendedAt).toBeNull();
  });
});

describe("assignRole / removeRole — authorization boundary + audit", () => {
  it("requires roles.manage", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);
    const target = await user();

    await expect(assignRole(target.id, "TEACHER", strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("an admin can assign and then remove a role; both are audited", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const target = await user();

    await assignRole(target.id, "TEACHER", adminActor);
    let roles = await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toContain("TEACHER");

    const assignAudit = await prisma.auditEvent.findFirst({ where: { action: "role.assigned", entityId: target.id } });
    expect(assignAudit).not.toBeNull();

    await removeRole(target.id, "TEACHER", adminActor);
    roles = await prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).not.toContain("TEACHER");

    const removeAudit = await prisma.auditEvent.findFirst({ where: { action: "role.removed", entityId: target.id } });
    expect(removeAudit).not.toBeNull();
  });

  it("assigning the same role twice is idempotent, not an error", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const target = await user();

    await assignRole(target.id, "STUDENT", adminActor);
    await expect(assignRole(target.id, "STUDENT", adminActor)).resolves.not.toThrow();

    const roles = await prisma.userRole.findMany({ where: { userId: target.id } });
    expect(roles).toHaveLength(1);
  });
});

describe("listUsers — authorization boundary + filtering (Session 03)", () => {
  it("requires users.read", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(listUsers({}, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("a users.read holder can list users, and the role filter narrows results", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const teacher = await user({ roles: ["TEACHER"] });

    const all = await listUsers({}, adminActor);
    expect(all.users.map((u) => u.id)).toContain(teacher.id);
    expect(all.users.map((u) => u.id)).toContain(admin.id);

    const teachersOnly = await listUsers({ role: "TEACHER" }, adminActor);
    expect(teachersOnly.users.map((u) => u.id)).toContain(teacher.id);
    expect(teachersOnly.users.map((u) => u.id)).not.toContain(admin.id);
  });

  it("the status filter narrows to suspended accounts only", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const suspended = await user({ status: "suspended" });
    const active = await user({ status: "active" });

    const result = await listUsers({ status: "suspended" }, adminActor);
    expect(result.users.map((u) => u.id)).toContain(suspended.id);
    expect(result.users.map((u) => u.id)).not.toContain(active.id);
  });

  it("the search filter matches name or email (case-insensitive substring)", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const target = await user();
    await prisma.user.update({ where: { id: target.id }, data: { name: "Zephyrine Uncommon Name" } });

    const result = await listUsers({ search: "zephyrine" }, adminActor);
    expect(result.users.map((u) => u.id)).toEqual([target.id]);
  });

  it("pagination reports total independent of page size and returns the requested page", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    for (let i = 0; i < 3; i++) await user({ roles: ["STUDENT"] });

    const page1 = await listUsers({ role: "STUDENT", page: 1, pageSize: 2 }, adminActor);
    expect(page1.users).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);

    const page2 = await listUsers({ role: "STUDENT", page: 2, pageSize: 2 }, adminActor);
    expect(page2.users.length).toBeGreaterThan(0);
    expect(new Set(page1.users.map((u) => u.id))).not.toEqual(new Set(page2.users.map((u) => u.id)));
  });
});

describe("getUserById — authorization boundary", () => {
  it("requires users.read", async () => {
    const stranger = await user();
    const target = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(getUserById(target.id, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("returns the user's roles for a users.read holder, and null for a nonexistent id", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const target = await user({ roles: ["TEACHER"] });

    const found = await getUserById(target.id, adminActor);
    expect(found?.roles).toEqual(["TEACHER"]);

    const missing = await getUserById("00000000-0000-0000-0000-000000000000", adminActor);
    expect(missing).toBeNull();
  });
});
