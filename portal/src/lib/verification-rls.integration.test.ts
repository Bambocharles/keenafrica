import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_verification migration's RLS policies are
 * enforced by Postgres itself, against the real non-superuser
 * portal_rls_test role — see src/lib/rls.integration.test.ts's header for
 * why this matters. Targets this session's own acceptance criterion
 * directly and literally: "only an authorized reviewer can grant or revoke
 * VERIFIED" — proven here as a DB-level guarantee, not just an
 * application-layer check that a crafted request could bypass.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Keen Africans LinkedIn Verification Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean; permissions?: string[] },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      return fn(tx);
    });
  }

  /** Genuinely anonymous — mirrors withRls({}) as called by the public article/profile pages' getVerifiedUserIds(). */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let self_: { id: string };
  let outsider: { id: string };
  let reviewerUser: { id: string };
  let verifiedOwner: { id: string };
  let connectedRowId: string;
  let verifiedRowId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `verification-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    self_ = await mk("self");
    outsider = await mk("outsider");
    reviewerUser = await mk("reviewer");

    const connected = await setup.keenAfricanVerification.create({
      data: { userId: self_.id, status: "linkedin_connected", linkedinName: "RLS Self", connectedAt: new Date() },
      select: { id: true },
    });
    connectedRowId = connected.id;

    verifiedOwner = await mk("verified-self");
    const verified = await setup.keenAfricanVerification.create({
      data: {
        userId: verifiedOwner.id,
        status: "verified",
        linkedinName: "RLS Verified",
        connectedAt: new Date(),
        reviewedAt: new Date(),
        reviewedBy: reviewerUser.id,
      },
      select: { id: true },
    });
    verifiedRowId = verified.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.keenAfricanVerification.deleteMany({ where: { id: { in: [connectedRowId, verifiedRowId] } } });
    await setup.user.deleteMany({ where: { id: { in: [self_.id, outsider.id, reviewerUser.id, verifiedOwner.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("select: the row's own user can read it", async () => {
    const row = await asContext({ userId: self_.id }, (tx) => tx.keenAfricanVerification.findUnique({ where: { id: connectedRowId } }));
    expect(row?.id).toBe(connectedRowId);
  });

  it("select: an unrelated logged-in user cannot read a pending (linkedin_connected) row", async () => {
    const row = await asContext({ userId: outsider.id }, (tx) => tx.keenAfricanVerification.findUnique({ where: { id: connectedRowId } }));
    expect(row).toBeNull();
  });

  it("select: an anonymous caller (no app.user_id at all) cannot read a pending row — only 'verified' is publicly visible", async () => {
    const row = await asAnonymous((tx) => tx.keenAfricanVerification.findUnique({ where: { id: connectedRowId } }));
    expect(row).toBeNull();
  });

  it("select: an anonymous caller CAN read a verified row — the one deliberately public branch (getVerifiedUserIds() relies on exactly this)", async () => {
    const row = await asAnonymous((tx) => tx.keenAfricanVerification.findUnique({ where: { id: verifiedRowId } }));
    expect(row?.status).toBe("verified");
  });

  it("select: verification.review holders can read a pending row belonging to someone else", async () => {
    const row = await asContext({ userId: reviewerUser.id, permissions: ["verification.review"] }, (tx) =>
      tx.keenAfricanVerification.findUnique({ where: { id: connectedRowId } })
    );
    expect(row?.id).toBe(connectedRowId);
  });

  it("THE core guarantee: a crafted self-issued UPDATE can never set status to 'verified', even with no permission check in front of it", async () => {
    await expect(
      asContext({ userId: self_.id }, (tx) =>
        tx.keenAfricanVerification.update({ where: { id: connectedRowId }, data: { status: "verified" } })
      )
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const row = await setup.keenAfricanVerification.findUniqueOrThrow({ where: { id: connectedRowId } });
    expect(row.status).toBe("linkedin_connected");
    await setup.$disconnect();
  });

  it("a self-issued UPDATE that also tries to set reviewedBy to itself is blocked the same way", async () => {
    await expect(
      asContext({ userId: self_.id }, (tx) =>
        tx.keenAfricanVerification.update({
          where: { id: connectedRowId },
          data: { status: "verified", reviewedBy: self_.id, reviewedAt: new Date() },
        })
      )
    ).rejects.toThrow();
  });

  it("self CAN reconnect (write their own row back to linkedin_connected)", async () => {
    const updated = await asContext({ userId: self_.id }, (tx) =>
      tx.keenAfricanVerification.update({ where: { id: connectedRowId }, data: { status: "linkedin_connected", linkedinName: "Renamed" } })
    );
    expect(updated.status).toBe("linkedin_connected");
    expect(updated.linkedinName).toBe("Renamed");
  });

  it("an outsider (no verification.review) cannot update someone else's row at all, not even to a valid status", async () => {
    await expect(
      asContext({ userId: outsider.id }, (tx) =>
        tx.keenAfricanVerification.update({ where: { id: connectedRowId }, data: { status: "linkedin_connected" } })
      )
    ).rejects.toThrow();
  });

  it("verification.review CAN move a pending row to 'verified'", async () => {
    const updated = await asContext({ userId: reviewerUser.id, permissions: ["verification.review"] }, (tx) =>
      tx.keenAfricanVerification.update({
        where: { id: connectedRowId },
        data: { status: "verified", reviewedAt: new Date(), reviewedBy: reviewerUser.id },
      })
    );
    expect(updated.status).toBe("verified");

    // Restore for any later test ordering.
    const setup = new PrismaClient();
    await setup.keenAfricanVerification.update({
      where: { id: connectedRowId },
      data: { status: "linkedin_connected", reviewedAt: null, reviewedBy: null },
    });
    await setup.$disconnect();
  });

  it("verification.review cannot move SOMEONE ELSE's row to 'linkedin_connected' — the review policy's WITH CHECK restricts it to {verified, rejected} only, and the reviewer doesn't own the row so no other policy covers this write", async () => {
    await expect(
      asContext({ userId: reviewerUser.id, permissions: ["verification.review"] }, (tx) =>
        tx.keenAfricanVerification.update({ where: { id: connectedRowId }, data: { status: "linkedin_connected" } })
      )
    ).rejects.toThrow();
  });

  it("insert: a self-issued INSERT can never create anything but a linkedin_connected row", async () => {
    const setup = new PrismaClient();
    const freshUser = await setup.user.create({
      data: { email: `verification-rls-fresh-${randomUUID()}@example.com`, name: "RLS Fresh", passwordHash: "x" },
      select: { id: true },
    });

    await expect(
      asContext({ userId: freshUser.id }, (tx) =>
        tx.keenAfricanVerification.create({ data: { userId: freshUser.id, status: "verified" } })
      )
    ).rejects.toThrow();

    const created = await asContext({ userId: freshUser.id }, (tx) =>
      tx.keenAfricanVerification.create({ data: { userId: freshUser.id, status: "linkedin_connected", connectedAt: new Date() } })
    );
    expect(created.status).toBe("linkedin_connected");

    await setup.keenAfricanVerification.delete({ where: { userId: freshUser.id } });
    await setup.user.delete({ where: { id: freshUser.id } });
    await setup.$disconnect();
  });
});
