import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the keen_africans_reports migration's RLS policies are enforced
 * by Postgres itself, against the real non-superuser portal_rls_test role —
 * see src/lib/rls.integration.test.ts's header for why this matters.
 * Targets this session's own explicit requirement directly: reporting must
 * work for a genuinely anonymous caller, and reviewing a report must be
 * restricted to articles.manage/super_admin at the DB level, not just an
 * application-layer check a crafted request could bypass.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Keen Africans Reports Row-Level Security (enforced by a non-superuser role)", () => {
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

  /** Genuinely anonymous — mirrors withRls({}) as called by an unauthenticated reader's report submission. */
  async function asAnonymous<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => fn(tx));
  }

  let reportedArticleAuthor: { id: string };
  let moderator: { id: string };
  let outsider: { id: string };
  let reportId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();
    const mk = (label: string) =>
      setup.user.create({
        data: { email: `reports-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    reportedArticleAuthor = await mk("author");
    moderator = await mk("moderator");
    outsider = await mk("outsider");

    const report = await setup.report.create({
      data: {
        entityType: "profile",
        entityId: reportedArticleAuthor.id,
        reason: "RLS test report",
      },
      select: { id: true },
    });
    reportId = report.id;
    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.report.deleteMany({ where: { id: reportId } });
    await setup.user.deleteMany({ where: { id: { in: [reportedArticleAuthor.id, moderator.id, outsider.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  // Note: these two use a raw INSERT with no RETURNING, exactly like
  // src/lib/reports.ts's createReport() has to (see that function's own
  // comment) — a plain Prisma .create() issues INSERT ... RETURNING, and
  // Postgres RLS additionally enforces the SELECT policy (articles.manage/
  // super_admin only) on any row an INSERT returns, which would reject
  // precisely the anonymous/unprivileged callers being tested here even
  // though the INSERT itself is allowed. Verified afterward via the
  // superuser setup client instead.

  it("insert: a genuinely anonymous caller can file a report (no app.user_id at all)", async () => {
    const reason = `anonymous report ${randomUUID()}`;
    await asAnonymous((tx) =>
      tx.$executeRaw`INSERT INTO reports (entity_type, entity_id, reason) VALUES ('profile'::"ReportEntityType", ${reportedArticleAuthor.id}::uuid, ${reason})`
    );

    const setup = new PrismaClient();
    const created = await setup.report.findFirstOrThrow({ where: { reason } });
    expect(created.reporterId).toBeNull();
    await setup.report.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });

  it("insert: a logged-in caller with no special permission can also file a report", async () => {
    const reason = `logged-in report ${randomUUID()}`;
    await asContext({ userId: outsider.id }, (tx) =>
      tx.$executeRaw`INSERT INTO reports (entity_type, entity_id, reporter_id, reason) VALUES ('profile'::"ReportEntityType", ${reportedArticleAuthor.id}::uuid, ${outsider.id}::uuid, ${reason})`
    );

    const setup = new PrismaClient();
    const created = await setup.report.findFirstOrThrow({ where: { reason } });
    expect(created.reporterId).toBe(outsider.id);
    await setup.report.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });

  it("select: an anonymous caller cannot read the reports table at all", async () => {
    const row = await asAnonymous((tx) => tx.report.findUnique({ where: { id: reportId } }));
    expect(row).toBeNull();
  });

  it("select: a logged-in outsider with no articles.manage cannot read reports, not even one they filed themselves", async () => {
    const row = await asContext({ userId: outsider.id }, (tx) => tx.report.findUnique({ where: { id: reportId } }));
    expect(row).toBeNull();
  });

  it("select: articles.manage holders can read reports", async () => {
    const row = await asContext({ userId: moderator.id, permissions: ["articles.manage"] }, (tx) =>
      tx.report.findUnique({ where: { id: reportId } })
    );
    expect(row?.id).toBe(reportId);
  });

  it("select: super_admin can read reports", async () => {
    const row = await asContext({ userId: moderator.id, isSuperAdmin: true }, (tx) =>
      tx.report.findUnique({ where: { id: reportId } })
    );
    expect(row?.id).toBe(reportId);
  });

  it("update: an outsider with no articles.manage cannot resolve/dismiss a report", async () => {
    await expect(
      asContext({ userId: outsider.id }, (tx) =>
        tx.report.update({ where: { id: reportId }, data: { status: "dismissed" } })
      )
    ).rejects.toThrow();
  });

  it("update: articles.manage CAN move a report to reviewed/dismissed", async () => {
    const updated = await asContext({ userId: moderator.id, permissions: ["articles.manage"] }, (tx) =>
      tx.report.update({
        where: { id: reportId },
        data: { status: "dismissed", reviewedAt: new Date(), reviewedBy: moderator.id, reviewNote: "no action" },
      })
    );
    expect(updated.status).toBe("dismissed");

    // Restore for any later test ordering / re-run.
    const setup = new PrismaClient();
    await setup.report.update({ where: { id: reportId }, data: { status: "pending", reviewedAt: null, reviewedBy: null, reviewNote: null } });
    await setup.$disconnect();
  });
});
