import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Verifies Row-Level Security is actually enforced by Postgres itself, not
 * just by application-layer permission checks. This matters specifically
 * because the default local-dev DATABASE_URL (README.md) connects as the
 * `postgres` superuser, which ALWAYS bypasses RLS — so every other test in
 * this repo that runs withRls() against the default local dev DB is
 * exercising application logic only, never proving the DB-level backstop
 * documented in the identity_security_foundation migration actually holds.
 *
 * Requires RLS_TEST_DATABASE_URL, pointing at the non-superuser
 * `portal_rls_test` role created by scripts/dev/create-rls-test-role.sql.
 * Skips (not fails) when unset, so this doesn't block anyone who hasn't
 * run that one-time local setup step — see the script's header comment.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Row-Level Security (enforced by a non-superuser role)", () => {
  const client = new PrismaClient({ datasourceUrl: RLS_TEST_URL });

  async function asContext<T>(
    ctx: { userId?: string; isSuperAdmin?: boolean; permissions?: string[] },
    fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>
  ): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${String(!!ctx.isSuperAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.permissions', ${JSON.stringify(ctx.permissions ?? [])}, true)`;
      await tx.$executeRaw`SELECT set_config('app.auth_lookup', 'false', true)`;
      await tx.$executeRaw`SELECT set_config('app.password_reset_lookup', 'false', true)`;
      return fn(tx);
    });
  }

  let userA: { id: string };
  let userB: { id: string };

  beforeAll(async () => {
    // Table owner/migrator-equivalent for fixture setup only — a second
    // client on the same superuser connection the rest of the suite uses,
    // so fixture writes aren't themselves subject to the RLS this suite is
    // testing.
    const setup = new PrismaClient();
    userA = await setup.user.create({
      data: { email: `rls-test-a-${randomUUID()}@example.com`, name: "RLS Test A", passwordHash: "x" },
      select: { id: true },
    });
    userB = await setup.user.create({
      data: { email: `rls-test-b-${randomUUID()}@example.com`, name: "RLS Test B", passwordHash: "x" },
      select: { id: true },
    });
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.session.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await setup.auditEvent.deleteMany({ where: { entityId: { in: [userA.id, userB.id] } } });
    await setup.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("users_select: an unauthenticated context sees no rows", async () => {
    const rows = await asContext({}, (tx) => tx.user.findMany());
    expect(rows).toHaveLength(0);
  });

  it("users_select: a user sees only their own row, not another user's", async () => {
    const rows = await asContext({ userId: userA.id }, (tx) =>
      tx.user.findMany({ where: { id: { in: [userA.id, userB.id] } } })
    );
    expect(rows.map((r) => r.id)).toEqual([userA.id]);
  });

  it("users_select: users.read permission grants visibility into another user's row", async () => {
    const rows = await asContext({ userId: userA.id, permissions: ["users.read"] }, (tx) =>
      tx.user.findMany({ where: { id: { in: [userA.id, userB.id] } } })
    );
    expect(rows.map((r) => r.id).sort()).toEqual([userA.id, userB.id].sort());
  });

  it("sessions_write: a user can only create a session row for themselves", async () => {
    await expect(
      asContext({ userId: userA.id }, (tx) =>
        tx.session.create({
          data: { userId: userB.id, expiresAt: new Date(Date.now() + 60_000) },
        })
      )
    ).rejects.toThrow();

    // Sanity: creating one's own session row is allowed.
    const own = await asContext({ userId: userA.id }, (tx) =>
      tx.session.create({
        data: { userId: userA.id, expiresAt: new Date(Date.now() + 60_000) },
      })
    );
    expect(own.userId).toBe(userA.id);
  });

  it("sessions_update: revoking another user's session fails without sessions.revoke, succeeds with it", async () => {
    const session = await asContext({ userId: userB.id }, (tx) =>
      tx.session.create({
        data: { userId: userB.id, expiresAt: new Date(Date.now() + 60_000) },
      })
    );

    // userA has no relationship to this session and no sessions.revoke —
    // the UPDATE must affect zero rows (RLS silently filters, it doesn't
    // throw, for an UPDATE whose WHERE clause matches no visible rows).
    await expect(
      asContext({ userId: userA.id }, (tx) =>
        tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
      )
    ).rejects.toThrow(); // Prisma throws P2025 (record not found) when RLS hides the target row

    const revoked = await asContext({ userId: userA.id, permissions: ["sessions.revoke"] }, (tx) =>
      tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    );
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("audit_events: insert succeeds with no authenticated context at all (e.g. a failed login)", async () => {
    // Plain INSERT, no RETURNING — matches how recordAuditEvent() actually
    // writes (see src/lib/audit.ts's comment: tx.auditEvent.create() would
    // trigger a RETURNING that the SELECT policy then rejects for an
    // unauthenticated actor, even though the INSERT policy itself is
    // unconditional).
    await expect(
      asContext(
        {},
        (tx) =>
          tx.$executeRaw`INSERT INTO audit_events (action, entity_type, entity_id) VALUES ('login.denied_suspended', 'User', ${userA.id})`
      )
    ).resolves.not.toThrow();
  });

  it("audit_events: select is denied without audit.read or super_admin", async () => {
    const rows = await asContext({ userId: userA.id }, (tx) =>
      tx.auditEvent.findMany({ where: { entityId: userA.id } })
    );
    expect(rows).toHaveLength(0);
  });

  it("audit_events: select succeeds with audit.read", async () => {
    const rows = await asContext({ userId: userA.id, permissions: ["audit.read"] }, (tx) =>
      tx.auditEvent.findMany({ where: { entityId: userA.id } })
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("audit_events: there is no UPDATE or DELETE policy — both fail even for super_admin", async () => {
    const [event] = await asContext({ userId: userA.id, permissions: ["audit.read"] }, (tx) =>
      tx.auditEvent.findMany({ where: { entityId: userA.id }, take: 1 })
    );
    expect(event).toBeTruthy();

    await expect(
      asContext({ isSuperAdmin: true }, (tx) =>
        tx.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } })
      )
    ).rejects.toThrow();

    await expect(
      asContext({ isSuperAdmin: true }, (tx) => tx.auditEvent.delete({ where: { id: event.id } }))
    ).rejects.toThrow();
  });
});
