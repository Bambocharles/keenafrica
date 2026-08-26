import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  createSession,
  listSessions,
  resolveSessionAuthz,
  revokeAllUserSessions,
  revokeAllUserSessionsAsSystem,
  revokeSession,
} from "@/lib/sessions";
import { actorFromUser, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

describe("resolveSessionAuthz — the per-request revocation check", () => {
  it("returns a snapshot with the user's roles/permissions for a valid session", async () => {
    const u = await user({ roles: ["TROUBLESHOOTER"] });
    const session = await createSession({ userId: u.id });

    const snapshot = await resolveSessionAuthz(session.id, u.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe("active");
    expect(snapshot!.roles).toEqual(["TROUBLESHOOTER"]);
    expect(snapshot!.permissions.sort()).toEqual(
      ["audit.read", "sessions.read", "sessions.revoke", "users.read"].sort()
    );
  });

  it("returns null for a session that doesn't exist", async () => {
    const u = await user();
    expect(await resolveSessionAuthz("00000000-0000-0000-0000-000000000000", u.id)).toBeNull();
  });

  it("returns null once the session has been revoked — this is what makes revocation real", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    expect(await resolveSessionAuthz(session.id, u.id)).not.toBeNull();

    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    expect(await resolveSessionAuthz(session.id, u.id)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id, ttlMs: -1 });
    expect(await resolveSessionAuthz(session.id, u.id)).toBeNull();
  });

  it("returns null once the account is suspended, even with an otherwise-valid session", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    expect(await resolveSessionAuthz(session.id, u.id)).not.toBeNull();

    await prisma.user.update({ where: { id: u.id }, data: { status: "suspended" } });

    expect(await resolveSessionAuthz(session.id, u.id)).toBeNull();
  });

  it("a session id does not authorize a different user id (cross-user session confusion must fail)", async () => {
    const u1 = await user();
    const u2 = await user();
    const session = await createSession({ userId: u1.id });

    expect(await resolveSessionAuthz(session.id, u2.id)).toBeNull();
  });
});

describe("listSessions — authorization boundary", () => {
  it("the owner can list their own sessions", async () => {
    const u = await user();
    await createSession({ userId: u.id });
    const actor = await actorFromUser(u.id);

    const sessions = await listSessions(u.id, actor);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it("a different user without sessions.read cannot list someone else's sessions", async () => {
    const owner = await user();
    const stranger = await user();
    await createSession({ userId: owner.id });
    const strangerActor = await actorFromUser(stranger.id);

    await expect(listSessions(owner.id, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("a sessions.read holder can list another user's sessions", async () => {
    const owner = await user();
    const troubleshooter = await user({ roles: ["TROUBLESHOOTER"] });
    await createSession({ userId: owner.id });
    const troubleshooterActor = await actorFromUser(troubleshooter.id);

    const sessions = await listSessions(owner.id, troubleshooterActor);
    expect(sessions.length).toBeGreaterThan(0);
  });
});

describe("revokeSession — authorization boundary", () => {
  it("the owner can revoke their own session", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    const actor = await actorFromUser(u.id);

    await revokeSession(session.id, actor);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedBy).toBe(u.id);
  });

  it("a different user without sessions.revoke cannot revoke someone else's session", async () => {
    const owner = await user();
    const stranger = await user();
    const session = await createSession({ userId: owner.id });
    const strangerActor = await actorFromUser(stranger.id);

    await expect(revokeSession(session.id, strangerActor)).rejects.toThrow(AuthorizationError);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.revokedAt).toBeNull();
  });

  it("a sessions.revoke holder (e.g. troubleshooter) can revoke another user's session and it is audited", async () => {
    const owner = await user();
    const troubleshooter = await user({ roles: ["TROUBLESHOOTER"] });
    const session = await createSession({ userId: owner.id });
    const troubleshooterActor = await actorFromUser(troubleshooter.id);

    await revokeSession(session.id, troubleshooterActor);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedBy).toBe(troubleshooter.id);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "session.revoked", entityId: session.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(troubleshooter.id);
  });

  it("revoking an already-revoked session is a no-op, not an error", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    const actor = await actorFromUser(u.id);

    await revokeSession(session.id, actor);
    await expect(revokeSession(session.id, actor)).resolves.not.toThrow();
  });
});

describe("revokeAllUserSessions / revokeAllUserSessionsAsSystem", () => {
  it("revokes every active session for the target and leaves already-revoked ones alone", async () => {
    const u = await user();
    const s1 = await createSession({ userId: u.id });
    const s2 = await createSession({ userId: u.id });
    await prisma.session.update({ where: { id: s1.id }, data: { revokedAt: new Date() } });

    const actor = await actorFromUser(u.id);
    const count = await revokeAllUserSessions(u.id, actor);

    expect(count).toBe(1); // only s2 was still active
    const row2 = await prisma.session.findUniqueOrThrow({ where: { id: s2.id } });
    expect(row2.revokedAt).not.toBeNull();
  });

  it("a stranger without sessions.revoke cannot bulk-revoke someone else's sessions", async () => {
    const owner = await user();
    const stranger = await user();
    await createSession({ userId: owner.id });
    const strangerActor = await actorFromUser(stranger.id);

    await expect(revokeAllUserSessions(owner.id, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("the system variant is not authorization-checked and is meant for already-authorized callers (e.g. suspendUser)", async () => {
    const u = await user();
    await createSession({ userId: u.id });

    const count = await revokeAllUserSessionsAsSystem(u.id, u.id);
    expect(count).toBe(1);
  });
});
