import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { actorFromUser, cleanupTestUsers, createTestUser } from "@/lib/test-support";
import {
  FEATURE_FLAGS,
  isFeatureEnabled,
  listFeatureFlags,
  setFeatureFlag,
  _resetFeatureFlagCache,
} from "./feature-flags";

const ORIGINAL_OVERRIDES = process.env.FEATURE_FLAG_OVERRIDES;

afterEach(() => {
  process.env.FEATURE_FLAG_OVERRIDES = ORIGINAL_OVERRIDES;
  _resetFeatureFlagCache();
});

describe("isFeatureEnabled", () => {
  it("honors FEATURE_FLAG_OVERRIDES without touching the database", async () => {
    process.env.FEATURE_FLAG_OVERRIDES = JSON.stringify({
      [FEATURE_FLAGS.MESSAGING]: true,
      [FEATURE_FLAGS.AI_TUTORING]: false,
    });

    await expect(isFeatureEnabled(FEATURE_FLAGS.MESSAGING)).resolves.toBe(true);
    await expect(isFeatureEnabled(FEATURE_FLAGS.AI_TUTORING)).resolves.toBe(
      false
    );
  });

  it("ignores malformed override JSON instead of throwing", async () => {
    process.env.FEATURE_FLAG_OVERRIDES = "{not json";
    // Falls through to the DB lookup path; DATABASE_URL in this test run
    // points at the local dev DB seeded with defaults (all disabled).
    await expect(
      isFeatureEnabled(FEATURE_FLAGS.MESSAGING)
    ).resolves.toBe(false);
  });
});

describe("listFeatureFlags", () => {
  it("returns every seeded flag, public (no actor required)", async () => {
    const flags = await listFeatureFlags();
    expect(flags.map((f) => f.key)).toEqual(expect.arrayContaining(Object.values(FEATURE_FLAGS)));
  });
});

describe("setFeatureFlag — authorization boundary (Session 03)", () => {
  const createdUserIds: string[] = [];
  afterAll(async () => {
    await cleanupTestUsers(createdUserIds);
    // Leave the shared feature_flags table as this suite found it.
    await prisma.featureFlag.update({ where: { key: FEATURE_FLAGS.AI_TUTORING }, data: { enabled: false } });
  });

  it("requires flags.manage", async () => {
    const stranger = await createTestUser();
    createdUserIds.push(stranger.id);
    const strangerActor = await actorFromUser(stranger.id);

    await expect(setFeatureFlag(FEATURE_FLAGS.AI_TUTORING, true, strangerActor)).rejects.toThrow(
      AuthorizationError
    );
    const row = await prisma.featureFlag.findUniqueOrThrow({ where: { key: FEATURE_FLAGS.AI_TUTORING } });
    expect(row.enabled).toBe(false);
  });

  it("a flags.manage holder (ADMIN) can toggle a flag, it busts the cache, and it is audited", async () => {
    const admin = await createTestUser({ roles: ["ADMIN"] });
    createdUserIds.push(admin.id);
    const adminActor = await actorFromUser(admin.id);

    // Prime the cache with the pre-toggle (disabled) value.
    _resetFeatureFlagCache();
    expect(await isFeatureEnabled(FEATURE_FLAGS.AI_TUTORING)).toBe(false);

    await setFeatureFlag(FEATURE_FLAGS.AI_TUTORING, true, adminActor);

    const row = await prisma.featureFlag.findUniqueOrThrow({ where: { key: FEATURE_FLAGS.AI_TUTORING } });
    expect(row.enabled).toBe(true);
    // The cache was busted by setFeatureFlag(), not just left stale for 30s.
    expect(await isFeatureEnabled(FEATURE_FLAGS.AI_TUTORING)).toBe(true);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "feature_flag.updated", entityId: FEATURE_FLAGS.AI_TUTORING },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(admin.id);
    expect(audit!.metadata).toEqual({ enabled: true });
  });
});
