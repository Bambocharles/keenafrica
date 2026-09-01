import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  VerificationNotFoundError,
  VerificationStateError,
  approveVerification,
  connectLinkedIn,
  getOwnVerification,
  getVerifiedUserIds,
  listPendingVerificationReviews,
  rejectVerification,
} from "@/lib/verification";
import { actorFromUser, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Session 40 (Keen Africans — LinkedIn Verification). Application-layer
 * coverage of the full state machine (unverified/no-row -> linkedin_connected
 * -> verified/rejected -> reconnect) and the authorization boundary around
 * approve/reject — see verification-rls.integration.test.ts for the
 * independent Postgres-level proof that a crafted self-write can never
 * reach 'verified' regardless of what this application layer checks.
 */

const createdUserIds: string[] = [];
async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

/** keen_african_verifications has two FK columns to users (userId, reviewedBy) — clean up by either, before cleanupTestUsers() deletes the User rows (ON DELETE NO ACTION). */
async function cleanupVerifications(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.keenAfricanVerification.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { reviewedBy: { in: userIds } }] },
  });
}

afterAll(async () => {
  await cleanupVerifications(createdUserIds);
  await cleanupTestUsers(createdUserIds);
});

async function connectedActor() {
  const u = await user({ roles: ["KEEN_AFRICAN"] });
  const actor = await actorFromUser(u.id);
  await connectLinkedIn(actor, {
    providerAccountId: randomUUID(),
    name: "Ada Test",
    pictureUrl: "https://media.licdn.com/ada.jpg",
  });
  return { user: u, actor };
}

async function reviewer() {
  const u = await user({ roles: ["ADMIN"] });
  return actorFromUser(u.id);
}

describe("connectLinkedIn — self-service connect", () => {
  it("creates a row with status linkedin_connected, snapshotting the LinkedIn identity", async () => {
    const { actor } = await connectedActor();
    const row = await getOwnVerification(actor);
    expect(row?.status).toBe("linkedin_connected");
    expect(row?.linkedinName).toBe("Ada Test");
    expect(row?.connectedAt).toBeTruthy();
  });

  it("getOwnVerification returns null before ever connecting — 'unverified' is the absence of a row, not a stored value", async () => {
    const u = await user({ roles: ["KEEN_AFRICAN"] });
    const actor = await actorFromUser(u.id);
    expect(await getOwnVerification(actor)).toBeNull();
  });

  it("reconnecting after a rejection resets status to linkedin_connected and clears the prior review", async () => {
    const { user: u, actor } = await connectedActor();
    const admin = await reviewer();
    await rejectVerification(u.id, admin, "Name didn't match");

    await connectLinkedIn(actor, { providerAccountId: randomUUID(), name: "Ada Test", pictureUrl: null });
    const row = await getOwnVerification(actor);
    expect(row?.status).toBe("linkedin_connected");
    expect(row?.reviewNote).toBeNull();
    expect(row?.reviewedBy).toBeNull();
  });

  it("reconnecting while already VERIFIED demotes back to linkedin_connected (relinking a different LinkedIn account must never silently keep the old badge)", async () => {
    const { user: u, actor } = await connectedActor();
    const admin = await reviewer();
    await approveVerification(u.id, admin);
    expect((await getOwnVerification(actor))?.status).toBe("verified");

    await connectLinkedIn(actor, { providerAccountId: randomUUID(), name: "A Different Name", pictureUrl: null });
    const row = await getOwnVerification(actor);
    expect(row?.status).toBe("linkedin_connected");
  });
});

describe("approveVerification — reviewer only", () => {
  it("a plain KEEN_AFRICAN (no verification.review) cannot approve — application-layer authorization", async () => {
    const { user: u, actor } = await connectedActor();
    await expect(approveVerification(u.id, actor)).rejects.toThrow(AuthorizationError);
  });

  it("an authorized reviewer can approve a pending connection, and it's audited", async () => {
    const { user: u } = await connectedActor();
    const admin = await reviewer();
    const row = await approveVerification(u.id, admin);
    expect(row.status).toBe("verified");
    expect(row.reviewedBy).toBe(admin.id);
    expect(row.reviewedAt).toBeTruthy();

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "verification.approved", entityId: u.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("cannot approve an account that never connected LinkedIn", async () => {
    const u = await user({ roles: ["KEEN_AFRICAN"] });
    const admin = await reviewer();
    await expect(approveVerification(u.id, admin)).rejects.toThrow(VerificationNotFoundError);
  });

  it("cannot approve an already-verified account again", async () => {
    const { user: u } = await connectedActor();
    const admin = await reviewer();
    await approveVerification(u.id, admin);
    await expect(approveVerification(u.id, admin)).rejects.toThrow(VerificationStateError);
  });
});

describe("rejectVerification — reject a pending review, or revoke an already-verified account", () => {
  it("a plain KEEN_AFRICAN cannot reject/revoke anyone's verification", async () => {
    const { user: u, actor } = await connectedActor();
    await expect(rejectVerification(u.id, actor, "self-service attempt")).rejects.toThrow(AuthorizationError);
  });

  it("requires a non-empty reason", async () => {
    const { user: u } = await connectedActor();
    const admin = await reviewer();
    await expect(rejectVerification(u.id, admin, "   ")).rejects.toThrow();
  });

  it("rejects a pending review, records the reason, and it's audited", async () => {
    const { user: u } = await connectedActor();
    const admin = await reviewer();
    const row = await rejectVerification(u.id, admin, "Photo doesn't match the name");
    expect(row.status).toBe("rejected");
    expect(row.reviewNote).toBe("Photo doesn't match the name");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "verification.rejected", entityId: u.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("revokes an already-VERIFIED account (the same function covers both reject and revoke)", async () => {
    const { user: u } = await connectedActor();
    const admin = await reviewer();
    await approveVerification(u.id, admin);

    const row = await rejectVerification(u.id, admin, "Later found to be fraudulent");
    expect(row.status).toBe("rejected");
  });

  it("cannot reject/revoke an account with no verification row at all", async () => {
    const u = await user({ roles: ["KEEN_AFRICAN"] });
    const admin = await reviewer();
    await expect(rejectVerification(u.id, admin, "n/a")).rejects.toThrow(VerificationNotFoundError);
  });
});

describe("listPendingVerificationReviews — the minimal reviewer queue", () => {
  it("requires verification.review", async () => {
    const { actor } = await connectedActor();
    await expect(listPendingVerificationReviews(actor)).rejects.toThrow(AuthorizationError);
  });

  it("lists connected-but-unreviewed accounts, and never verified/rejected ones", async () => {
    const { user: pending } = await connectedActor();
    const { user: alreadyVerified } = await connectedActor();
    const admin = await reviewer();
    await approveVerification(alreadyVerified.id, admin);

    const queue = await listPendingVerificationReviews(admin);
    const ids = queue.map((r) => r.userId);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(alreadyVerified.id);
  });
});

describe("getVerifiedUserIds — public badge lookup", () => {
  it("returns only VERIFIED accounts, never linkedin_connected/rejected ones", async () => {
    const { user: verified } = await connectedActor();
    const { user: pending } = await connectedActor();
    const { user: rejected } = await connectedActor();
    const admin = await reviewer();
    await approveVerification(verified.id, admin);
    await rejectVerification(rejected.id, admin, "no");

    const result = await getVerifiedUserIds([verified.id, pending.id, rejected.id]);
    expect(result.has(verified.id)).toBe(true);
    expect(result.has(pending.id)).toBe(false);
    expect(result.has(rejected.id)).toBe(false);
  });

  it("returns an empty set for accounts that never connected LinkedIn", async () => {
    const u = await user({ roles: ["KEEN_AFRICAN"] });
    const result = await getVerifiedUserIds([u.id]);
    expect(result.size).toBe(0);
  });
});
