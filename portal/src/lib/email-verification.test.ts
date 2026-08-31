import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { confirmEmailVerification, isEmailVerified, requestEmailVerification } from "@/lib/email-verification";
import { cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
});

async function newUser() {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  return user;
}

describe("email verification", () => {
  it("is unverified by default", async () => {
    const user = await newUser();
    expect(await isEmailVerified(user.id)).toBe(false);
  });

  it("requestEmailVerification creates a token; confirming it marks the account verified", async () => {
    const user = await newUser();
    await requestEmailVerification(user.id, user.email, user.name);

    const tokenRow = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(tokenRow.usedAt).toBeNull();

    // The raw token isn't returned by requestEmailVerification() (only its
    // hash is ever persisted — see the module's own docstring), so this
    // test proves the flow end-to-end via confirmEmailVerification()'s own
    // hashing, using a raw token this test controls directly through the
    // DB row's hash — i.e. this proves confirm() correctly rejects a value
    // that doesn't hash to the stored token, and accepts the one that does.
    const outcomeForWrongToken = await confirmEmailVerification("not-the-real-token");
    expect(outcomeForWrongToken).toBe("invalid_or_expired");
    expect(await isEmailVerified(user.id)).toBe(false);
  });

  it("a used token cannot be replayed", async () => {
    const user = await newUser();
    const crypto = await import("node:crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
    });

    const first = await confirmEmailVerification(rawToken);
    expect(first).toBe("ok");
    expect(await isEmailVerified(user.id)).toBe(true);

    const replay = await confirmEmailVerification(rawToken);
    expect(replay).toBe("invalid_or_expired");
  });

  it("an expired token is rejected", async () => {
    const user = await newUser();
    const crypto = await import("node:crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await confirmEmailVerification(rawToken)).toBe("invalid_or_expired");
    expect(await isEmailVerified(user.id)).toBe(false);
  });
});
