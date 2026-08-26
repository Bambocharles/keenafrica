import { afterAll, describe, expect, it } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

describe("requestPasswordReset", () => {
  it("issues a single-use token for an active account, stored only as a hash", async () => {
    const u = await user();

    const result = await requestPasswordReset(u.email);

    expect(result.token).toBeTruthy();
    const record = await prisma.passwordResetToken.findFirst({ where: { userId: u.id } });
    expect(record).not.toBeNull();
    expect(record!.tokenHash).not.toBe(result.token); // never the raw token at rest
  });

  it("returns a null token for an email that doesn't exist — same shape as a real account, no enumeration signal", async () => {
    const result = await requestPasswordReset(`nobody-${Date.now()}@example.com`);
    expect(result.token).toBeNull();
  });

  it("returns a null token for a suspended account, without revealing that distinction", async () => {
    const u = await user({ status: "suspended" });
    const result = await requestPasswordReset(u.email);
    expect(result.token).toBeNull();
  });
});

describe("resetPassword", () => {
  it("rejects an invalid token", async () => {
    const outcome = await resetPassword("not-a-real-token", "NewPassword123!");
    expect(outcome).toBe("invalid_or_expired");
  });

  it("on a valid token: sets the new password, consumes the token, and revokes every existing session", async () => {
    const u = await user();
    const session = await createSession({ userId: u.id });
    const { token } = await requestPasswordReset(u.email);

    const outcome = await resetPassword(token!, "BrandNewPassword123!");
    expect(outcome).toBe("ok");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await compare("BrandNewPassword123!", row.passwordHash)).toBe(true);

    const sessionRow = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionRow.revokedAt).not.toBeNull();

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "password_reset.completed", entityId: u.id },
    });
    expect(audit).not.toBeNull();
  });

  it("a token cannot be used twice", async () => {
    const u = await user();
    const { token } = await requestPasswordReset(u.email);

    expect(await resetPassword(token!, "FirstReset123!")).toBe("ok");
    expect(await resetPassword(token!, "SecondReset123!")).toBe("invalid_or_expired");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await compare("FirstReset123!", row.passwordHash)).toBe(true);
  });

  it("an expired token is rejected even though it was never used", async () => {
    const u = await user();
    const { token } = await requestPasswordReset(u.email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: u.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await resetPassword(token!, "TooLate123!")).toBe("invalid_or_expired");
  });
});
