import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_follows migration's RLS policies (and the
 * follows_no_self_follow_check CHECK constraint) are enforced by Postgres
 * itself, against the real non-superuser portal_rls_test role — see
 * src/lib/rls.integration.test.ts's header for why this matters. Targets
 * this session's own explicit requirement directly: a crafted request
 * (not just src/lib/follows.ts's own application-layer checks) must be
 * unable to follow yourself, double-follow, or delete someone else's
 * follow relationship.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Keen Africans Follows Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      return fn(tx);
    });
  }

  /** Genuinely anonymous — mirrors withRls({}) as called by the public profile page's follower-count read. */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let alice: { id: string };
  let bob: { id: string };
  let carol: { id: string };
  let aliceFollowsBobId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    const mk = (label: string) =>
      setup.user.create({
        data: { email: `follows-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    alice = await mk("alice");
    bob = await mk("bob");
    carol = await mk("carol");

    const follow = await setup.follow.create({
      data: { followerId: alice.id, followingId: bob.id },
      select: { id: true },
    });
    aliceFollowsBobId = follow.id;
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.follow.deleteMany({ where: { OR: [{ followerId: { in: [alice.id, bob.id, carol.id] } }, { followingId: { in: [alice.id, bob.id, carol.id] } }] } });
    await setup.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("select: a genuinely anonymous caller CAN read the follows table (public reputation signal)", async () => {
    const row = await asAnonymous((tx) => tx.follow.findUnique({ where: { id: aliceFollowsBobId } }));
    expect(row?.id).toBe(aliceFollowsBobId);
  });

  it("insert: a logged-in caller can create a follow row as themselves", async () => {
    await asContext({ userId: carol.id }, (tx) =>
      tx.$executeRaw`INSERT INTO follows (follower_id, following_id) VALUES (${carol.id}::uuid, ${bob.id}::uuid)`
    );

    const setup = new PrismaClient();
    const created = await setup.follow.findFirstOrThrow({ where: { followerId: carol.id, followingId: bob.id } });
    await setup.follow.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });

  it("insert: cannot create a follow row on someone else's behalf (follower_id must equal app.user_id)", async () => {
    await expect(
      asContext({ userId: carol.id }, (tx) =>
        tx.$executeRaw`INSERT INTO follows (follower_id, following_id) VALUES (${alice.id}::uuid, ${bob.id}::uuid)`
      )
    ).rejects.toThrow();
  });

  it("insert: a genuinely anonymous caller cannot create a follow row at all", async () => {
    await expect(
      asAnonymous((tx) => tx.$executeRaw`INSERT INTO follows (follower_id, following_id) VALUES (${carol.id}::uuid, ${bob.id}::uuid)`)
    ).rejects.toThrow();
  });

  it("insert: the RLS policy rejects a crafted self-follow even for an authenticated caller", async () => {
    await expect(
      asContext({ userId: carol.id }, (tx) =>
        tx.$executeRaw`INSERT INTO follows (follower_id, following_id) VALUES (${carol.id}::uuid, ${carol.id}::uuid)`
      )
    ).rejects.toThrow();
  });

  it("insert: the CHECK constraint rejects a self-follow even under the super_admin RLS bypass", async () => {
    await expect(
      asContext({ userId: carol.id, isSuperAdmin: true }, (tx) =>
        tx.$executeRaw`INSERT INTO follows (follower_id, following_id) VALUES (${carol.id}::uuid, ${carol.id}::uuid)`
      )
    ).rejects.toThrow();
  });

  it("insert: the unique constraint rejects a double-follow at the DB layer", async () => {
    await expect(
      asContext({ userId: alice.id }, (tx) =>
        tx.$executeRaw`INSERT INTO follows (follower_id, following_id) VALUES (${alice.id}::uuid, ${bob.id}::uuid)`
      )
    ).rejects.toThrow();
  });

  it("delete: an outsider cannot remove someone else's follow relationship", async () => {
    await expect(
      asContext({ userId: carol.id }, (tx) => tx.follow.delete({ where: { id: aliceFollowsBobId } }))
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const stillThere = await setup.follow.findUnique({ where: { id: aliceFollowsBobId } });
    expect(stillThere).not.toBeNull();
    await setup.$disconnect();
  });

  it("delete: the follower themselves CAN remove their own follow relationship", async () => {
    const setup = new PrismaClient();
    const toDelete = await setup.follow.create({ data: { followerId: bob.id, followingId: carol.id }, select: { id: true } });
    await setup.$disconnect();

    await asContext({ userId: bob.id }, (tx) => tx.follow.delete({ where: { id: toDelete.id } }));

    const check = new PrismaClient();
    const gone = await check.follow.findUnique({ where: { id: toDelete.id } });
    expect(gone).toBeNull();
    await check.$disconnect();
  });

  it("delete: super_admin can remove any follow relationship", async () => {
    const setup = new PrismaClient();
    const toDelete = await setup.follow.create({ data: { followerId: carol.id, followingId: alice.id }, select: { id: true } });
    await setup.$disconnect();

    await asContext({ userId: bob.id, isSuperAdmin: true }, (tx) => tx.follow.delete({ where: { id: toDelete.id } }));

    const check = new PrismaClient();
    const gone = await check.follow.findUnique({ where: { id: toDelete.id } });
    expect(gone).toBeNull();
    await check.$disconnect();
  });
});
