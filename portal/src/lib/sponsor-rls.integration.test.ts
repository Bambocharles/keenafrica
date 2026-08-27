import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the sponsor_core migration's RLS policies are enforced by Postgres
 * itself, against the real non-superuser portal_rls_test role — see
 * src/lib/rls.integration.test.ts's header comment for why this matters
 * (the default local dev DATABASE_URL connects as the superuser, which
 * always bypasses RLS regardless of policy). This suite specifically
 * targets Session 11's explicit acceptance criterion: cross-sponsor data
 * isolation is enforced server-side, independent of the application-layer
 * checks in src/lib/sponsor.ts.
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Sponsor Core Row-Level Security (enforced by a non-superuser role)", () => {
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

  let sponsorAdminA: { id: string };
  let sponsorAdminB: { id: string };
  let outsider: { id: string };
  let sponsorId: string;
  let projectA: { id: string };
  let projectB: { id: string };
  let milestoneB: { id: string };

  const SPONSOR_PROJECTS_READ = ["sponsor.projects.read"];

  beforeAll(async () => {
    // Table-owner-equivalent superuser connection for fixture setup only —
    // fixture writes here aren't subject to the RLS this suite tests.
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `sponsor-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    sponsorAdminA = await mk("sponsor-a");
    sponsorAdminB = await mk("sponsor-b");
    outsider = await mk("outsider");

    const sponsor = await setup.sponsor.create({ data: { name: "RLS Test Sponsor" }, select: { id: true } });
    sponsorId = sponsor.id;

    const pA = await setup.project.create({ data: { sponsorId, name: "Project A", slug: `rls-a-${randomUUID()}` }, select: { id: true } });
    projectA = pA;
    const pB = await setup.project.create({ data: { sponsorId, name: "Project B", slug: `rls-b-${randomUUID()}`, status: "draft" }, select: { id: true } });
    projectB = pB;

    await setup.projectMembership.create({ data: { userId: sponsorAdminA.id, projectId: projectA.id, role: "sponsor_admin" } });
    await setup.projectMembership.create({ data: { userId: sponsorAdminB.id, projectId: projectB.id, role: "sponsor_admin" } });

    const m = await setup.milestone.create({
      data: { projectId: projectB.id, title: "B milestone", createdBy: sponsorAdminB.id },
      select: { id: true },
    });
    milestoneB = m;
    await setup.projectMetric.create({ data: { projectId: projectB.id, label: "reach", value: 10, createdBy: sponsorAdminB.id } });

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.milestone.deleteMany({ where: { projectId: { in: [projectA.id, projectB.id] } } });
    await setup.projectMetric.deleteMany({ where: { projectId: { in: [projectA.id, projectB.id] } } });
    await setup.projectMembership.deleteMany({ where: { projectId: { in: [projectA.id, projectB.id] } } });
    await setup.project.deleteMany({ where: { id: { in: [projectA.id, projectB.id] } } });
    await setup.sponsor.delete({ where: { id: sponsorId } });
    await setup.user.deleteMany({ where: { id: { in: [sponsorAdminA.id, sponsorAdminB.id, outsider.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("projects_select: a draft project is visible to its own sponsor team but invisible to an outsider or the wrong project's team", async () => {
    const ownTeamRows = await asContext({ userId: sponsorAdminB.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.project.findMany({ where: { id: projectB.id } })
    );
    expect(ownTeamRows).toHaveLength(1);

    const wrongTeamRows = await asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.project.findMany({ where: { id: projectB.id } })
    );
    expect(wrongTeamRows).toHaveLength(0);

    const outsiderRows = await asContext({ userId: outsider.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.project.findMany({ where: { id: projectB.id } })
    );
    expect(outsiderRows).toHaveLength(0);
  });

  it("milestones_select / project_metrics_select: cross-sponsor isolation — Project A's team sees none of Project B's rows", async () => {
    const ownMilestones = await asContext({ userId: sponsorAdminB.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.milestone.findMany({ where: { projectId: projectB.id } })
    );
    expect(ownMilestones).toHaveLength(1);

    const crossSponsorMilestones = await asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.milestone.findMany({ where: { projectId: projectB.id } })
    );
    expect(crossSponsorMilestones).toHaveLength(0);

    const crossSponsorMetrics = await asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.projectMetric.findMany({ where: { projectId: projectB.id } })
    );
    expect(crossSponsorMetrics).toHaveLength(0);
  });

  it("milestones_write: a sponsor-team member (sponsor.projects.read only, no sponsor.manage) cannot INSERT a milestone even on their own project", async () => {
    await expect(
      asContext({ userId: sponsorAdminB.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.milestone.create({ data: { projectId: projectB.id, title: "Sneaky", createdBy: sponsorAdminB.id } })
      )
    ).rejects.toThrow();
  });

  it("milestones_update: a Project A team member cannot tamper with a Project B milestone even by row id", async () => {
    await expect(
      asContext({ userId: sponsorAdminA.id, permissions: [...SPONSOR_PROJECTS_READ, "sponsor.manage"] }, (tx) =>
        tx.milestone.update({ where: { id: milestoneB.id }, data: { title: "tampered" } })
      )
    ).resolves.toBeDefined(); // sponsor.manage is a blanket bypass, not ownership-scoped — this IS allowed.

    // Revert via superuser so the next assertion is clean.
    const setup = new PrismaClient();
    await setup.milestone.update({ where: { id: milestoneB.id }, data: { title: "B milestone" } });
    await setup.$disconnect();

    // Without sponsor.manage, ownership scoping alone (no bypass) denies it.
    await expect(
      asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.milestone.update({ where: { id: milestoneB.id }, data: { title: "tampered again" } })
      )
    ).rejects.toThrow();
  });

  it("project_memberships_select: RECURSION CHECK — a sponsor-team member sees their fellow team's membership rows via the SECURITY DEFINER helper without Postgres raising infinite recursion", async () => {
    const rows = await asContext({ userId: sponsorAdminB.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.projectMembership.findMany({ where: { projectId: projectB.id } })
    );
    expect(rows.map((r) => r.userId)).toContain(sponsorAdminB.id);

    const crossSponsorRows = await asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
      tx.projectMembership.findMany({ where: { projectId: projectB.id } })
    );
    expect(crossSponsorRows).toHaveLength(0);
  });

  it("memberships_write: sponsor.users.manage lets a project's own team add ANOTHER sponsor_admin row, but never a beneficiary row, and never on a project they're not on", async () => {
    const setupForFixture = new PrismaClient();
    const newColleague = await setupForFixture.user.create({
      data: { email: `sponsor-rls-colleague-${randomUUID()}@example.com`, name: "Colleague", passwordHash: "x" },
      select: { id: true },
    });
    await setupForFixture.$disconnect();

    try {
      const created = await asContext(
        { userId: sponsorAdminB.id, permissions: [...SPONSOR_PROJECTS_READ, "sponsor.users.manage"] },
        (tx) => tx.projectMembership.create({ data: { userId: newColleague.id, projectId: projectB.id, role: "sponsor_admin" } })
      );
      expect(created.role).toBe("sponsor_admin");

      const setup = new PrismaClient();
      await setup.projectMembership.delete({ where: { id: created.id } });
      await setup.$disconnect();

      // Same actor, same permission, but role='beneficiary' — denied.
      await expect(
        asContext({ userId: sponsorAdminB.id, permissions: [...SPONSOR_PROJECTS_READ, "sponsor.users.manage"] }, (tx) =>
          tx.projectMembership.create({ data: { userId: newColleague.id, projectId: projectB.id, role: "beneficiary" } })
        )
      ).rejects.toThrow();

      // Same actor targeting Project A (not their own team) — denied.
      await expect(
        asContext({ userId: sponsorAdminB.id, permissions: [...SPONSOR_PROJECTS_READ, "sponsor.users.manage"] }, (tx) =>
          tx.projectMembership.create({ data: { userId: newColleague.id, projectId: projectA.id, role: "sponsor_admin" } })
        )
      ).rejects.toThrow();
    } finally {
      const cleanup = new PrismaClient();
      await cleanup.projectMembership.deleteMany({ where: { userId: newColleague.id } });
      await cleanup.user.delete({ where: { id: newColleague.id } });
      await cleanup.$disconnect();
    }
  });

  it("project_documents_select / asset_attachments_select: cross-sponsor isolation for sponsor-visible documents (asset_attachments' 'sponsor_document' branch cascades through project_documents' own RLS — see the sponsor_asset_attachments migration)", async () => {
    const setup = new PrismaClient();
    const uploader = await setup.user.create({
      data: { email: `sponsor-rls-uploader-${randomUUID()}@example.com`, name: "Uploader", passwordHash: "x" },
      select: { id: true },
    });
    const asset = await setup.asset.create({
      data: {
        uploaderId: uploader.id,
        originalFilename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "x".repeat(64),
      },
      select: { id: true },
    });
    const document = await setup.projectDocument.create({
      data: { projectId: projectB.id, title: "B Report", assetId: asset.id, uploadedBy: uploader.id },
      select: { id: true },
    });
    await setup.assetAttachment.create({
      data: { assetId: asset.id, entityType: "sponsor_document", entityId: document.id, attachedBy: uploader.id },
    });
    await setup.$disconnect();

    try {
      // Project B's own sponsor team sees the document and its attachment row.
      const ownDocRows = await asContext({ userId: sponsorAdminB.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.projectDocument.findMany({ where: { id: document.id } })
      );
      expect(ownDocRows).toHaveLength(1);
      const ownAttachmentRows = await asContext({ userId: sponsorAdminB.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.assetAttachment.findMany({ where: { entityType: "sponsor_document", entityId: document.id } })
      );
      expect(ownAttachmentRows).toHaveLength(1);

      // Project A's team (a real sponsor-team member, just the wrong
      // project) sees neither — the exact cross-sponsor isolation case
      // manually reproduced live against the app's local-dev superuser
      // DB connection (which bypasses RLS entirely, as documented
      // throughout this codebase) during this session's verification pass.
      const crossDocRows = await asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.projectDocument.findMany({ where: { id: document.id } })
      );
      expect(crossDocRows).toHaveLength(0);
      const crossAttachmentRows = await asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.assetAttachment.findMany({ where: { entityType: "sponsor_document", entityId: document.id } })
      );
      expect(crossAttachmentRows).toHaveLength(0);

      // A total outsider with no project_memberships row at all sees neither.
      const outsiderDocRows = await asContext({ userId: outsider.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.projectDocument.findMany({ where: { id: document.id } })
      );
      expect(outsiderDocRows).toHaveLength(0);
    } finally {
      const cleanup = new PrismaClient();
      await cleanup.assetAttachment.deleteMany({ where: { entityType: "sponsor_document", entityId: document.id } });
      await cleanup.projectDocument.delete({ where: { id: document.id } });
      await cleanup.asset.delete({ where: { id: asset.id } });
      await cleanup.user.delete({ where: { id: uploader.id } });
      await cleanup.$disconnect();
    }
  });

  it("sponsors_write / projects_write: a plain sponsor.projects.read holder cannot create a sponsor or a project", async () => {
    await expect(
      asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) => tx.sponsor.create({ data: { name: "Sneaky Sponsor" } }))
    ).rejects.toThrow();

    await expect(
      asContext({ userId: sponsorAdminA.id, permissions: SPONSOR_PROJECTS_READ }, (tx) =>
        tx.project.create({ data: { sponsorId, name: "Sneaky Project", slug: `rls-sneaky-${randomUUID()}` } })
      )
    ).rejects.toThrow();
  });
});
