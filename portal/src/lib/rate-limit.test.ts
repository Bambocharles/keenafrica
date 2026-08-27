import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { recordAuditEvent } from "@/lib/audit";
import { isLoginRateLimited, LOGIN_ACCOUNT_WINDOW, LOGIN_IP_WINDOW } from "@/lib/rate-limit";
import { cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
async function user() {
  const u = await createTestUser();
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

async function recordFailures(count: number, opts: { actorId?: string | null; ipAddress?: string | null }) {
  for (let i = 0; i < count; i++) {
    await recordAuditEvent({
      actorId: opts.actorId ?? null,
      action: "login.failed",
      entityType: "User",
      entityId: opts.actorId ?? null,
      ipAddress: opts.ipAddress ?? null,
    });
  }
}

describe("isLoginRateLimited (Session 16)", () => {
  it("allows an account with no recent failures", async () => {
    const u = await user();
    await expect(isLoginRateLimited({ userId: u.id, ipAddress: `198.51.100.${Date.now() % 255}` })).resolves.toBe(
      false
    );
  });

  it("blocks once an account crosses its failure threshold, regardless of IP", async () => {
    const u = await user();
    await recordFailures(LOGIN_ACCOUNT_WINDOW.maxAttempts, { actorId: u.id });

    await expect(isLoginRateLimited({ userId: u.id, ipAddress: "203.0.113.1" })).resolves.toBe(true);
  });

  it("does not block a different account sharing no failure history", async () => {
    const u = await user();
    const other = await user();
    await recordFailures(LOGIN_ACCOUNT_WINDOW.maxAttempts, { actorId: other.id });

    await expect(isLoginRateLimited({ userId: u.id, ipAddress: "203.0.113.2" })).resolves.toBe(false);
  });

  it("blocks an unknown-email attempt once its source IP crosses the IP threshold", async () => {
    const ip = `192.0.2.${Date.now() % 255}`;
    // actorId null — mirrors a failed attempt against an email with no matching account.
    await recordFailures(LOGIN_IP_WINDOW.maxAttempts, { actorId: null, ipAddress: ip });

    await expect(isLoginRateLimited({ userId: null, ipAddress: ip })).resolves.toBe(true);
  });

  it("a fresh IP with no history is not blocked even for a known-blocked account", async () => {
    const u = await user();
    await recordFailures(LOGIN_ACCOUNT_WINDOW.maxAttempts - 1, { actorId: u.id });

    await expect(isLoginRateLimited({ userId: u.id, ipAddress: `192.0.2.${Date.now() % 255}` })).resolves.toBe(
      false
    );
  });
});
