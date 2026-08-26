import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { listAuditEvents, recordAuditEvent } from "@/lib/audit";
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

describe("listAuditEvents — authorization boundary (Session 03)", () => {
  it("requires audit.read", async () => {
    const stranger = await user();
    const strangerActor = await actorFromUser(stranger.id);

    await expect(listAuditEvents({}, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("an audit.read holder (e.g. troubleshooter) can list events, and the action filter narrows results", async () => {
    const troubleshooter = await user({ roles: ["TROUBLESHOOTER"] });
    const troubleshooterActor = await actorFromUser(troubleshooter.id);
    const target = await user();

    const marker = `test.marker.${Date.now()}`;
    await recordAuditEvent({ actorId: target.id, action: marker, entityType: "Test", entityId: target.id });

    const result = await listAuditEvents({ action: marker }, troubleshooterActor);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].action).toBe(marker);
    expect(result.events[0].actorEmail).toBe(target.email);
  });

  it("the entityType filter narrows results and pagination reports a total", async () => {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const marker = `Test.Entity.${Date.now()}`;

    await recordAuditEvent({ actorId: admin.id, action: "test.one", entityType: marker });
    await recordAuditEvent({ actorId: admin.id, action: "test.two", entityType: marker });

    const result = await listAuditEvents({ entityType: marker, page: 1, pageSize: 1 }, adminActor);
    expect(result.total).toBe(2);
    expect(result.events).toHaveLength(1);
  });
});
