import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the certificates_core / certificates_asset_attachments migrations'
 * RLS policies are enforced by Postgres itself, against the real
 * non-superuser portal_rls_test role — see
 * src/lib/rls.integration.test.ts's header comment for why this matters
 * (the default local dev DATABASE_URL connects as the superuser, which
 * always bypasses RLS regardless of policy).
 *
 * This is the acceptance criterion "certificate cannot be forged through
 * client-side manipulation"'s actual proof: no STUDENT or TEACHER role
 * holds certificates.manage (src/lib/authz.ts), so a real actor's own
 * permission set can never satisfy certificates_write — only
 * src/lib/certificates.ts's internal systemCertificateCtx() can, and that
 * is never exposed to a real request.
 *
 * Requires RLS_TEST_DATABASE_URL (see scripts/dev/create-rls-test-role.sql).
 * Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Certificates Row-Level Security (enforced by a non-superuser role)", () => {
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

  let teacher: { id: string };
  let outsiderTeacher: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };
  let courseId: string;
  let cohortId: string;
  let enrollmentId: string;
  let certificateId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `certificates-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    teacher = await mk("teacher");
    outsiderTeacher = await mk("outsider-teacher");
    studentA = await mk("student-a");
    studentB = await mk("student-b");

    const course = await setup.course.create({
      data: { title: "Certificates RLS Course", createdBy: teacher.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    courseId = course.id;
    const cohort = await setup.cohort.create({ data: { courseId, name: "Certificates RLS Cohort" }, select: { id: true } });
    cohortId = cohort.id;
    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    const enrollment = await setup.enrollment.create({
      data: { cohortId, studentUserId: studentA.id, status: "completed", completedAt: new Date() },
      select: { id: true },
    });
    enrollmentId = enrollment.id;

    const certificate = await setup.certificate.create({
      data: {
        studentUserId: studentA.id,
        courseId,
        enrollmentId,
        certificateNumber: `KA-TEST-${randomUUID()}`,
        studentNameSnapshot: "RLS student-a",
        courseTitleSnapshot: "Certificates RLS Course",
        completedAt: new Date(),
      },
      select: { id: true },
    });
    certificateId = certificate.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.assetAttachment.deleteMany({ where: { entityType: "certificate", entityId: certificateId } });
    await setup.certificate.deleteMany({ where: { courseId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({ where: { id: { in: [teacher.id, outsiderTeacher.id, studentA.id, studentB.id] } } });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("certificates_select: the owning student sees their certificate; a different student sees nothing", async () => {
    const own = await asContext({ userId: studentA.id }, (tx) => tx.certificate.findMany({ where: { id: certificateId } }));
    expect(own).toHaveLength(1);

    const other = await asContext({ userId: studentB.id }, (tx) => tx.certificate.findMany({ where: { id: certificateId } }));
    expect(other).toHaveLength(0);
  });

  it("certificates_select: the course's teacher (via cohort_teachers) sees it; an outsider teacher does not", async () => {
    const teacherRows = await asContext({ userId: teacher.id }, (tx) => tx.certificate.findMany({ where: { id: certificateId } }));
    expect(teacherRows).toHaveLength(1);

    const outsiderRows = await asContext({ userId: outsiderTeacher.id }, (tx) =>
      tx.certificate.findMany({ where: { id: certificateId } })
    );
    expect(outsiderRows).toHaveLength(0);
  });

  it("certificates_select: certificates.manage bypasses the same way super_admin does", async () => {
    const rows = await asContext({ permissions: ["certificates.manage"] }, (tx) =>
      tx.certificate.findMany({ where: { id: certificateId } })
    );
    expect(rows).toHaveLength(1);
  });

  it("certificates_write: the student cannot forge their own certificate, even with courses.manage — only certificates.manage may insert", async () => {
    const forgeAttempt = () =>
      asContext({ userId: studentB.id }, (tx) =>
        tx.certificate.create({
          data: {
            studentUserId: studentB.id,
            courseId,
            enrollmentId,
            certificateNumber: `KA-FORGED-${randomUUID()}`,
            studentNameSnapshot: "Forged",
            courseTitleSnapshot: "Forged",
            completedAt: new Date(),
          },
        })
      );
    await expect(forgeAttempt()).rejects.toThrow();

    const courseManageAttempt = () =>
      asContext({ userId: studentB.id, permissions: ["courses.manage"] }, (tx) =>
        tx.certificate.create({
          data: {
            studentUserId: studentB.id,
            courseId,
            enrollmentId,
            certificateNumber: `KA-FORGED2-${randomUUID()}`,
            studentNameSnapshot: "Forged",
            courseTitleSnapshot: "Forged",
            completedAt: new Date(),
          },
        })
      );
    await expect(courseManageAttempt()).rejects.toThrow();

    const created = await asContext({ userId: studentB.id, permissions: ["certificates.manage"] }, (tx) =>
      tx.certificate.create({
        data: {
          studentUserId: studentB.id,
          courseId,
          enrollmentId,
          certificateNumber: `KA-REAL-${randomUUID()}`,
          studentNameSnapshot: "Real",
          courseTitleSnapshot: "Real",
          completedAt: new Date(),
        },
      })
    );
    expect(created.studentUserId).toBe(studentB.id);

    const cleanup = new PrismaClient();
    await cleanup.certificate.delete({ where: { id: created.id } });
    await cleanup.$disconnect();
  });

  it("certificates_update: revocation requires certificates.manage; the certificate's own student cannot self-revoke or edit it", async () => {
    await expect(
      asContext({ userId: studentA.id }, (tx) =>
        tx.certificate.update({ where: { id: certificateId }, data: { status: "revoked" } })
      )
    ).rejects.toThrow();

    const revoked = await asContext({ permissions: ["certificates.manage"] }, (tx) =>
      tx.certificate.update({ where: { id: certificateId }, data: { status: "revoked", revokedReason: "test" } })
    );
    expect(revoked.status).toBe("revoked");

    // restore for any later test/teardown expectations
    const setup = new PrismaClient();
    await setup.certificate.update({ where: { id: certificateId }, data: { status: "active", revokedAt: null, revokedBy: null, revokedReason: null } });
    await setup.$disconnect();
  });

  it("no DELETE policy exists at all, even for super_admin", async () => {
    await expect(
      asContext({ isSuperAdmin: true }, (tx) => tx.certificate.delete({ where: { id: certificateId } }))
    ).rejects.toThrow();

    const setup = new PrismaClient();
    const stillThere = await setup.certificate.findUnique({ where: { id: certificateId } });
    expect(stillThere).not.toBeNull();
    await setup.$disconnect();
  });

  it("asset_attachments (entity_type='certificate'): visibility cascades through certificates_select", async () => {
    const asset = await asContext({ userId: studentA.id }, (tx) =>
      tx.asset.create({
        data: {
          uploaderId: studentA.id,
          originalFilename: "cert.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
          storageDriver: "local",
          storageKey: randomUUID(),
          checksumSha256: "x",
        },
      })
    );

    await expect(
      asContext({ userId: studentB.id }, (tx) =>
        tx.assetAttachment.create({
          data: { assetId: asset.id, entityType: "certificate", entityId: certificateId, attachedBy: studentB.id },
        })
      )
    ).rejects.toThrow();

    const attachment = await asContext({ permissions: ["certificates.manage"] }, (tx) =>
      tx.assetAttachment.create({
        data: { assetId: asset.id, entityType: "certificate", entityId: certificateId, attachedBy: studentA.id },
      })
    );

    const ownerSees = await asContext({ userId: studentA.id }, (tx) =>
      tx.assetAttachment.findMany({ where: { id: attachment.id } })
    );
    expect(ownerSees).toHaveLength(1);

    const outsiderSees = await asContext({ userId: studentB.id }, (tx) =>
      tx.assetAttachment.findMany({ where: { id: attachment.id } })
    );
    expect(outsiderSees).toHaveLength(0);

    const cleanup = new PrismaClient();
    await cleanup.assetAttachment.deleteMany({ where: { assetId: asset.id } });
    await cleanup.asset.deleteMany({ where: { id: asset.id } });
    await cleanup.$disconnect();
  });
});
