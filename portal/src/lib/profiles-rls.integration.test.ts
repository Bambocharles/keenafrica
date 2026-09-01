import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_profiles_core / keen_africans_avatar_asset_
 * attachments migrations' RLS policies are enforced by Postgres itself,
 * against the real non-superuser portal_rls_test role — see
 * src/lib/rls.integration.test.ts's header for why this matters, and
 * src/lib/articles-rls.integration.test.ts for the structure this mirrors.
 * Targets this session's own acceptance criteria directly: a profile is
 * readable by anyone with no app.user_id set at all, and nobody can write
 * or update another user's profile row even with a crafted request,
 * independent of whatever src/lib/profiles.ts's own checks do.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Profiles Row-Level Security (enforced by a non-superuser role)", () => {
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

  /** Genuinely anonymous — mirrors withRls({}) as called by the public profile page. No session vars set at all. */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let owner: { id: string };
  let outsider: { id: string };
  let owner2: { id: string };
  let profileId: string;
  let profile2Id: string;
  let avatarAssetId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `profile-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    owner = await mk("owner");
    outsider = await mk("outsider");
    owner2 = await mk("owner2");

    const profile = await setup.profile.create({
      data: { userId: owner.id, username: `rls-owner-${randomUUID().slice(0, 8)}`, displayName: "RLS Owner" },
      select: { id: true },
    });
    profileId = profile.id;

    // A second profile with NO avatar attachment yet — isolates the
    // asset_attachments_write RLS test below from the unique
    // ([entityType, entityId]) constraint the first profile's own avatar
    // attachment would otherwise also trip, which would make that test
    // pass for the wrong reason.
    const profile2 = await setup.profile.create({
      data: { userId: owner2.id, username: `rls-owner2-${randomUUID().slice(0, 8)}`, displayName: "RLS Owner 2" },
      select: { id: true },
    });
    profile2Id = profile2.id;

    const asset = await setup.asset.create({
      data: {
        uploaderId: owner.id,
        originalFilename: "avatar.png",
        mimeType: "image/png",
        sizeBytes: 10,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "0".repeat(64),
      },
      select: { id: true },
    });
    avatarAssetId = asset.id;
    await setup.assetAttachment.create({
      data: { assetId: avatarAssetId, entityType: "avatar", entityId: profileId, attachedBy: owner.id },
    });
    await setup.profile.update({ where: { id: profileId }, data: { avatarAssetId } });

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.assetAttachment.deleteMany({ where: { entityId: { in: [profileId, profile2Id] } } });
    await setup.profile.deleteMany({ where: { id: { in: [profileId, profile2Id] } } });
    await setup.asset.deleteMany({ where: { id: avatarAssetId } });
    await setup.user.deleteMany({ where: { id: { in: [owner.id, outsider.id, owner2.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("profiles_select: an anonymous caller (no app.user_id at all) can read the profile", async () => {
    const row = await asAnonymous((tx) => tx.profile.findUnique({ where: { id: profileId } }));
    expect(row?.id).toBe(profileId);
  });

  it("profiles_write: an outsider cannot insert a profile row for someone else's user_id", async () => {
    await expect(
      asContext({ userId: outsider.id }, (tx) =>
        tx.profile.create({ data: { userId: owner.id, username: `spoofed-${randomUUID().slice(0, 8)}`, displayName: "Spoofed" } })
      )
    ).rejects.toThrow();
  });

  it("profiles_update: an outsider cannot update another user's profile, even one they can read", async () => {
    await expect(
      asContext({ userId: outsider.id }, (tx) =>
        tx.profile.update({ where: { id: profileId }, data: { displayName: "Hijacked" } })
      )
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const row = await setup.profile.findUniqueOrThrow({ where: { id: profileId } });
    expect(row.displayName).toBe("RLS Owner");
    await setup.$disconnect();
  });

  it("profiles_update: the owner can update their own profile", async () => {
    const updated = await asContext({ userId: owner.id }, (tx) =>
      tx.profile.update({ where: { id: profileId }, data: { bio: "Updated by owner" } })
    );
    expect(updated.bio).toBe("Updated by owner");
  });

  it("asset_attachments/assets cascade: an anonymous caller can see the avatar asset (profiles have no draft state)", async () => {
    const attachment = await asAnonymous((tx) =>
      tx.assetAttachment.findFirst({ where: { assetId: avatarAssetId, entityType: "avatar" } })
    );
    expect(attachment).not.toBeNull();

    const asset = await asAnonymous((tx) => tx.asset.findUnique({ where: { id: avatarAssetId } }));
    expect(asset?.id).toBe(avatarAssetId);
  });

  it("asset_attachments_write: an outsider cannot attach an avatar to someone else's profile", async () => {
    await expect(
      asContext({ userId: outsider.id }, (tx) =>
        tx.assetAttachment.create({
          data: { assetId: avatarAssetId, entityType: "avatar", entityId: profile2Id, attachedBy: outsider.id },
        })
      )
    ).rejects.toThrow();
  });

  it("asset_attachments_write: the profile's own owner can attach an avatar", async () => {
    const attachment = await asContext({ userId: owner2.id }, (tx) =>
      tx.assetAttachment.create({
        data: { assetId: avatarAssetId, entityType: "avatar", entityId: profile2Id, attachedBy: owner2.id },
      })
    );
    expect(attachment.entityId).toBe(profile2Id);
  });
});
