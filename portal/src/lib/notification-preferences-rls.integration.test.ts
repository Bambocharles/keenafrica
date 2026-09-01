import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_notification_preferences migration's RLS
 * policies are enforced by Postgres itself, against the real non-superuser
 * portal_rls_test role — see src/lib/rls.integration.test.ts's header for
 * why this matters, and src/lib/profiles-rls.integration.test.ts for the
 * structure this mirrors (self-only read/write/update/delete, unlike
 * notifications' system-write shape).
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("NotificationPreference Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', '[]', true)`;
      return fn(tx);
    });
  }

  let owner: { id: string };
  let stranger: { id: string };
  let prefId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    owner = await setup.user.create({
      data: { email: `pref-rls-owner-${randomUUID()}@example.com`, name: "RLS Owner", passwordHash: "x" },
      select: { id: true },
    });
    stranger = await setup.user.create({
      data: { email: `pref-rls-stranger-${randomUUID()}@example.com`, name: "RLS Stranger", passwordHash: "x" },
      select: { id: true },
    });
    const pref = await setup.notificationPreference.create({
      data: { userId: owner.id, type: "article_unpublished_by_admin", enabled: false },
      select: { id: true },
    });
    prefId = pref.id;
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.notificationPreference.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } });
    await setup.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  describe("notification_preferences_select", () => {
    it("the owner sees their own preference row", async () => {
      const rows = await asContext({ userId: owner.id }, (tx) => tx.notificationPreference.findMany({ where: { id: prefId } }));
      expect(rows).toHaveLength(1);
    });

    it("a stranger sees nothing — not even that the row exists", async () => {
      const rows = await asContext({ userId: stranger.id }, (tx) => tx.notificationPreference.findMany({ where: { id: prefId } }));
      expect(rows).toHaveLength(0);
    });

    it("super_admin can see any user's preference row", async () => {
      const rows = await asContext({ isSuperAdmin: true }, (tx) => tx.notificationPreference.findMany({ where: { id: prefId } }));
      expect(rows).toHaveLength(1);
    });
  });

  describe("notification_preferences_write — self-only INSERT", () => {
    it("a stranger cannot INSERT an opt-out row for another user's id, even with a crafted request", async () => {
      await expect(
        asContext({ userId: stranger.id }, (tx) =>
          tx.notificationPreference.create({
            data: { userId: owner.id, type: "message_received", enabled: false },
          })
        )
      ).rejects.toThrow(/row-level security/);
    });

    it("a user can insert their own opt-out row", async () => {
      const created = await asContext({ userId: stranger.id }, (tx) =>
        tx.notificationPreference.create({
          data: { userId: stranger.id, type: "message_received", enabled: false },
        })
      );
      expect(created.userId).toBe(stranger.id);

      const setup = new PrismaClient();
      await setup.notificationPreference.delete({ where: { id: created.id } });
      await setup.$disconnect();
    });
  });

  describe("notification_preferences_update — self-only", () => {
    it("a stranger's UPDATE affects zero rows", async () => {
      await expect(
        asContext({ userId: stranger.id }, (tx) =>
          tx.notificationPreference.update({ where: { id: prefId }, data: { enabled: true } })
        )
      ).rejects.toThrow();

      const setup = new PrismaClient();
      const row = await setup.notificationPreference.findUnique({ where: { id: prefId }, select: { enabled: true } });
      expect(row?.enabled).toBe(false);
      await setup.$disconnect();
    });

    it("the owner can update their own row", async () => {
      const updated = await asContext({ userId: owner.id }, (tx) =>
        tx.notificationPreference.update({ where: { id: prefId }, data: { enabled: true } })
      );
      expect(updated.enabled).toBe(true);

      const setup = new PrismaClient();
      await setup.notificationPreference.update({ where: { id: prefId }, data: { enabled: false } });
      await setup.$disconnect();
    });
  });

  describe("notification_preferences_delete — self-only", () => {
    it("a stranger cannot delete another user's opt-out row", async () => {
      await expect(
        asContext({ userId: stranger.id }, (tx) => tx.notificationPreference.delete({ where: { id: prefId } }))
      ).rejects.toThrow();

      const setup = new PrismaClient();
      const row = await setup.notificationPreference.findUnique({ where: { id: prefId } });
      expect(row).not.toBeNull();
      await setup.$disconnect();
    });

    it("the owner can delete their own opt-out row (setNotificationPreference()'s re-enable path)", async () => {
      const setup = new PrismaClient();
      const doomed = await setup.notificationPreference.create({
        data: { userId: owner.id, type: "assessment_graded", enabled: false },
        select: { id: true },
      });
      await setup.$disconnect();

      await asContext({ userId: owner.id }, (tx) => tx.notificationPreference.delete({ where: { id: doomed.id } }));

      const verify = new PrismaClient();
      const row = await verify.notificationPreference.findUnique({ where: { id: doomed.id } });
      expect(row).toBeNull();
      await verify.$disconnect();
    });
  });
});
