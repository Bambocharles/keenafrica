import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the notifications_core migration's RLS policies are enforced by
 * Postgres itself, against the real non-superuser portal_rls_test role —
 * see src/lib/rls.integration.test.ts's header comment for why this
 * matters (the default local dev DATABASE_URL is the Postgres superuser,
 * which bypasses RLS entirely regardless of policy).
 *
 * This is the actual proof behind two of this session's acceptance
 * criteria: recipient authorization ("Must NOT expose another user's
 * notifications" — notifications_select) and that the unconditional
 * notifications_write INSERT policy really is unconditional (the mechanism
 * that lets a no-acting-user event listener write a notification for an
 * arbitrary recipient at all — see the migration's own header comment and
 * docs/NOTIFICATIONS.md).
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Notifications Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', '[]', true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      return fn(tx);
    });
  }

  let owner: { id: string };
  let stranger: { id: string };
  let notificationId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    owner = await setup.user.create({
      data: { email: `notif-rls-owner-${randomUUID()}@example.com`, name: "RLS Owner", passwordHash: "x" },
      select: { id: true },
    });
    stranger = await setup.user.create({
      data: { email: `notif-rls-stranger-${randomUUID()}@example.com`, name: "RLS Stranger", passwordHash: "x" },
      select: { id: true },
    });
    const notification = await setup.notification.create({
      data: {
        recipientId: owner.id,
        type: "message_received",
        title: "Test notification",
        body: "body",
        dedupeKey: `rls-test:${randomUUID()}`,
      },
      select: { id: true },
    });
    notificationId = notification.id;
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.notification.deleteMany({ where: { recipientId: { in: [owner.id, stranger.id] } } });
    await setup.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  describe("notifications_select", () => {
    it("the recipient sees their own notification", async () => {
      const rows = await asContext({ userId: owner.id }, (tx) => tx.notification.findMany({ where: { id: notificationId } }));
      expect(rows).toHaveLength(1);
    });

    it("a stranger sees nothing — not even that the row exists", async () => {
      const rows = await asContext({ userId: stranger.id }, (tx) => tx.notification.findMany({ where: { id: notificationId } }));
      expect(rows).toHaveLength(0);
    });

    it("super_admin can see any recipient's notification (support/debug bypass, same shape as every other table)", async () => {
      const rows = await asContext({ isSuperAdmin: true }, (tx) => tx.notification.findMany({ where: { id: notificationId } }));
      expect(rows).toHaveLength(1);
    });
  });

  describe("notifications_write — unconditional INSERT", () => {
    it("the SYSTEM context every real notification write uses (is_super_admin=true, no acting user — see src/lib/notifications.ts's SYSTEM_CTX) can INSERT for an arbitrary recipient", async () => {
      const dedupeKey = `rls-write-test:${randomUUID()}`;
      const created = await asContext({ isSuperAdmin: true }, (tx) =>
        tx.notification.create({
          data: { recipientId: owner.id, type: "message_received", title: "t", body: "b", dedupeKey },
        })
      );
      expect(created.recipientId).toBe(owner.id);

      const setup = new PrismaClient();
      await setup.notification.delete({ where: { id: created.id } });
      await setup.$disconnect();
    });

    // Postgres RLS also enforces a table's SELECT policy on any row
    // returned by INSERT ... RETURNING — the exact audit_events_write
    // pitfall this migration's own header comment cites. Prisma's typed
    // create() always appends RETURNING, so a non-privileged, non-recipient
    // actor's typed create() fails with "new row violates row-level
    // security policy" even though the INSERT's own WITH CHECK (true) never
    // rejected it — that failure is about RETURNING visibility, not the
    // INSERT check. A raw INSERT with no RETURNING is what actually proves
    // notifications_write's WITH CHECK has no auth condition at all,
    // exactly the same way recordAuditEvent() proves it for audit_events.
    it("a raw INSERT (no RETURNING) succeeds from a fully unauthenticated, non-recipient context — the WITH CHECK itself is truly unconditional", async () => {
      const dedupeKey = `rls-write-anon-test:${randomUUID()}`;
      await asContext({ userId: stranger.id }, (tx) =>
        tx.$executeRaw`
          INSERT INTO notifications (recipient_id, type, title, body, dedupe_key)
          VALUES (${owner.id}::uuid, 'message_received'::"NotificationType", 't', 'b', ${dedupeKey})
        `
      );

      const setup = new PrismaClient();
      const row = await setup.notification.findFirst({ where: { dedupeKey } });
      expect(row).not.toBeNull();
      expect(row?.recipientId).toBe(owner.id);
      await setup.notification.delete({ where: { id: row!.id } });
      await setup.$disconnect();
    });

    it("a typed create() from a non-privileged, non-recipient actor fails on the RETURNING-visibility check, not the INSERT check", async () => {
      const dedupeKey = `rls-write-returning-test:${randomUUID()}`;
      await expect(
        asContext({ userId: stranger.id }, (tx) =>
          tx.notification.create({
            data: { recipientId: owner.id, type: "message_received", title: "t", body: "b", dedupeKey },
          })
        )
      ).rejects.toThrow(/row-level security/);

      // Confirm the row was never actually left behind — Postgres rolls
      // back the whole statement when RETURNING's visibility check fails.
      const setup = new PrismaClient();
      const row = await setup.notification.findFirst({ where: { dedupeKey } });
      expect(row).toBeNull();
      await setup.$disconnect();
    });
  });

  describe("notifications_update — self-only", () => {
    it("the recipient can mark their own notification read", async () => {
      const updated = await asContext({ userId: owner.id }, (tx) =>
        tx.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } })
      );
      expect(updated.readAt).not.toBeNull();

      // Restore for the other tests in this file.
      const setup = new PrismaClient();
      await setup.notification.update({ where: { id: notificationId }, data: { readAt: null } });
      await setup.$disconnect();
    });

    it("a stranger's UPDATE affects zero rows (the WHERE-clause-level policy silently excludes it, per Prisma's update() semantics)", async () => {
      await expect(
        asContext({ userId: stranger.id }, (tx) =>
          tx.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } })
        )
      ).rejects.toThrow();

      const setup = new PrismaClient();
      const row = await setup.notification.findUnique({ where: { id: notificationId }, select: { readAt: true } });
      expect(row?.readAt).toBeNull();
      await setup.$disconnect();
    });
  });

  it("no DELETE policy exists for any role — a delete affects zero rows even as super_admin", async () => {
    const setup = new PrismaClient();
    const doomed = await setup.notification.create({
      data: { recipientId: owner.id, type: "message_received", title: "t", body: "b", dedupeKey: `rls-delete-test:${randomUUID()}` },
      select: { id: true },
    });
    await setup.$disconnect();

    await expect(asContext({ isSuperAdmin: true }, (tx) => tx.notification.delete({ where: { id: doomed.id } }))).rejects.toThrow();

    const cleanup = new PrismaClient();
    await cleanup.notification.delete({ where: { id: doomed.id } });
    await cleanup.$disconnect();
  });
});
