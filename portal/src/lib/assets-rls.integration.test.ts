import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the assets_files migration's RLS policies (assets/asset_attachments)
 * are enforced by Postgres itself, against the real non-superuser
 * portal_rls_test role — see src/lib/rls.integration.test.ts's header for
 * why this matters. Mirrors education-rls.integration.test.ts's structure
 * exactly, targeting this session's own acceptance criteria: draft content
 * stays invisible (asset visibility cascades through the same
 * lessons_select rules), ownership is enforced independently of the
 * application-layer checks in src/lib/assets.ts/content.ts, and an
 * uploader can never be spoofed.
 *
 * Requires RLS_TEST_DATABASE_URL. Skips (doesn't fail) when unset.
 */
const RLS_TEST_URL = process.env.RLS_TEST_DATABASE_URL;
const describeIfConfigured = RLS_TEST_URL ? describe : describe.skip;

describeIfConfigured("Asset/File Row-Level Security (enforced by a non-superuser role)", () => {
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

  let admin: { id: string };
  let teacher: { id: string };
  let outsiderTeacher: { id: string };
  let student: { id: string };
  let outsiderStudent: { id: string };
  let courseId: string;
  let cohortId: string;
  let draftLessonId: string;
  let publishedLessonId: string;
  let draftResourceId: string;
  let publishedResourceId: string;
  let draftAssetId: string;
  let publishedAssetId: string;
  let standaloneAssetId: string;

  beforeAll(async () => {
    const setup = new PrismaClient();

    const mk = (label: string) =>
      setup.user.create({
        data: { email: `asset-rls-${label}-${randomUUID()}@example.com`, name: `RLS ${label}`, passwordHash: "x" },
        select: { id: true },
      });
    admin = await mk("admin");
    teacher = await mk("teacher");
    outsiderTeacher = await mk("outsider-teacher");
    student = await mk("student");
    outsiderStudent = await mk("outsider-student");

    const course = await setup.course.create({
      data: { title: "Asset RLS Test Course", createdBy: admin.id, status: "published", publishedAt: new Date() },
      select: { id: true },
    });
    courseId = course.id;

    const cohort = await setup.cohort.create({ data: { courseId, name: "Asset RLS Cohort" }, select: { id: true } });
    cohortId = cohort.id;

    await setup.cohortTeacher.create({ data: { cohortId, teacherUserId: teacher.id } });
    await setup.enrollment.create({ data: { cohortId, studentUserId: student.id, status: "active" } });

    const module = await setup.module.create({
      data: { courseId, title: "RLS Module", order: 0, status: "published" },
      select: { id: true },
    });

    const draftLesson = await setup.lesson.create({
      data: { moduleId: module.id, courseId, title: "Draft Lesson", content: "secret", order: 0, status: "draft" },
      select: { id: true },
    });
    draftLessonId = draftLesson.id;

    const publishedLesson = await setup.lesson.create({
      data: { moduleId: module.id, courseId, title: "Published Lesson", content: "public", order: 1, status: "published" },
      select: { id: true },
    });
    publishedLessonId = publishedLesson.id;

    const draftAsset = await setup.asset.create({
      data: {
        uploaderId: teacher.id,
        originalFilename: "draft.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "0".repeat(64),
      },
      select: { id: true },
    });
    draftAssetId = draftAsset.id;
    const draftResource = await setup.resource.create({
      data: { lessonId: draftLessonId, title: "Draft Handout", type: "document", assetId: draftAssetId, createdBy: teacher.id },
      select: { id: true },
    });
    draftResourceId = draftResource.id;
    await setup.assetAttachment.create({
      data: { assetId: draftAssetId, entityType: "lesson_resource", entityId: draftResourceId, attachedBy: teacher.id },
    });

    const publishedAsset = await setup.asset.create({
      data: {
        uploaderId: teacher.id,
        originalFilename: "published.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "1".repeat(64),
      },
      select: { id: true },
    });
    publishedAssetId = publishedAsset.id;
    const publishedResource = await setup.resource.create({
      data: { lessonId: publishedLessonId, title: "Published Handout", type: "document", assetId: publishedAssetId, createdBy: teacher.id },
      select: { id: true },
    });
    publishedResourceId = publishedResource.id;
    await setup.assetAttachment.create({
      data: { assetId: publishedAssetId, entityType: "lesson_resource", entityId: publishedResourceId, attachedBy: teacher.id },
    });

    const standaloneAsset = await setup.asset.create({
      data: {
        uploaderId: teacher.id,
        originalFilename: "unattached.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "2".repeat(64),
      },
      select: { id: true },
    });
    standaloneAssetId = standaloneAsset.id;

    await setup.$disconnect();
  });

  afterAll(async () => {
    const setup = new PrismaClient();
    await setup.assetAttachment.deleteMany({ where: { entityId: { in: [draftResourceId, publishedResourceId] } } });
    await setup.resource.deleteMany({ where: { id: { in: [draftResourceId, publishedResourceId] } } });
    await setup.asset.deleteMany({ where: { id: { in: [draftAssetId, publishedAssetId, standaloneAssetId] } } });
    await setup.lesson.deleteMany({ where: { courseId } });
    await setup.module.deleteMany({ where: { courseId } });
    await setup.enrollment.deleteMany({ where: { cohortId } });
    await setup.cohortTeacher.deleteMany({ where: { cohortId } });
    await setup.cohort.deleteMany({ where: { courseId } });
    await setup.course.deleteMany({ where: { id: courseId } });
    await setup.user.deleteMany({
      where: { id: { in: [admin.id, teacher.id, outsiderTeacher.id, student.id, outsiderStudent.id] } },
    });
    await setup.$disconnect();
    await client.$disconnect();
  });

  it("assets_select: the assigned teacher sees both the draft-lesson and published-lesson assets", async () => {
    const rows = await asContext({ userId: teacher.id }, (tx) =>
      tx.asset.findMany({ where: { id: { in: [draftAssetId, publishedAssetId] } } })
    );
    expect(rows.map((r) => r.id).sort()).toEqual([draftAssetId, publishedAssetId].sort());
  });

  it("assets_select: an outsider teacher (no cohort assignment) sees neither asset", async () => {
    const rows = await asContext({ userId: outsiderTeacher.id }, (tx) =>
      tx.asset.findMany({ where: { id: { in: [draftAssetId, publishedAssetId] } } })
    );
    expect(rows).toHaveLength(0);
  });

  it("assets_select: an enrolled student sees only the published-lesson asset, never the draft one", async () => {
    const rows = await asContext({ userId: student.id }, (tx) =>
      tx.asset.findMany({ where: { id: { in: [draftAssetId, publishedAssetId] } } })
    );
    expect(rows.map((r) => r.id)).toEqual([publishedAssetId]);
  });

  it("assets_select: an unenrolled student sees neither asset", async () => {
    const rows = await asContext({ userId: outsiderStudent.id }, (tx) =>
      tx.asset.findMany({ where: { id: { in: [draftAssetId, publishedAssetId] } } })
    );
    expect(rows).toHaveLength(0);
  });

  it("assets_select: only the uploader can see an unattached (orphan) asset — nobody else can, not even the course teacher", async () => {
    const asUploader = await asContext({ userId: teacher.id }, (tx) => tx.asset.findUnique({ where: { id: standaloneAssetId } }));
    expect(asUploader?.id).toBe(standaloneAssetId);

    const asOutsider = await asContext({ userId: outsiderTeacher.id }, (tx) =>
      tx.asset.findUnique({ where: { id: standaloneAssetId } })
    );
    expect(asOutsider).toBeNull();
  });

  it("assets_write: a user cannot spoof another user's uploader_id", async () => {
    await expect(
      asContext({ userId: outsiderTeacher.id }, (tx) =>
        tx.asset.create({
          data: {
            uploaderId: teacher.id, // spoofed
            originalFilename: "spoofed.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            storageDriver: "local",
            storageKey: randomUUID(),
            checksumSha256: "3".repeat(64),
          },
        })
      )
    ).rejects.toThrow();
  });

  it("assets_write: a user CAN create an asset row attributed to themselves", async () => {
    const created = await asContext({ userId: outsiderTeacher.id }, (tx) =>
      tx.asset.create({
        data: {
          uploaderId: outsiderTeacher.id,
          originalFilename: "own.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          storageDriver: "local",
          storageKey: randomUUID(),
          checksumSha256: "4".repeat(64),
        },
      })
    );
    expect(created.uploaderId).toBe(outsiderTeacher.id);

    const setup = new PrismaClient();
    await setup.asset.delete({ where: { id: created.id } });
    await setup.$disconnect();
  });

  it("assets_update: only the uploader (or super_admin) can soft-delete their asset", async () => {
    await expect(
      asContext({ userId: outsiderTeacher.id }, (tx) =>
        tx.asset.update({ where: { id: standaloneAssetId }, data: { status: "deleted" } })
      )
    ).rejects.toThrow();

    // Confirm the row itself was genuinely untouched, not just that
    // Prisma's singular update() threw P2025 for the caller.
    const setup = new PrismaClient();
    const row = await setup.asset.findUniqueOrThrow({ where: { id: standaloneAssetId } });
    expect(row.status).toBe("active");
    await setup.$disconnect();
  });

  it("asset_attachments_write: an outsider teacher cannot attach an asset to another course's lesson_resource", async () => {
    const setup = new PrismaClient();
    const looseAsset = await setup.asset.create({
      data: {
        uploaderId: outsiderTeacher.id,
        originalFilename: "loose.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "5".repeat(64),
      },
      select: { id: true },
    });

    await expect(
      asContext({ userId: outsiderTeacher.id, permissions: ["courses.content.write"] }, (tx) =>
        tx.assetAttachment.create({
          data: {
            assetId: looseAsset.id,
            entityType: "lesson_resource",
            entityId: publishedResourceId,
            attachedBy: outsiderTeacher.id,
          },
        })
      )
    ).rejects.toThrow();

    await setup.asset.delete({ where: { id: looseAsset.id } });
    await setup.$disconnect();
  });

  it("asset_attachments_delete: the assigned teacher can detach; an outsider cannot", async () => {
    const setup = new PrismaClient();
    const tempAsset = await setup.asset.create({
      data: {
        uploaderId: teacher.id,
        originalFilename: "temp.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        storageDriver: "local",
        storageKey: randomUUID(),
        checksumSha256: "6".repeat(64),
      },
      select: { id: true },
    });
    const tempResource = await setup.resource.create({
      data: { lessonId: publishedLessonId, title: "Temp", type: "document", assetId: tempAsset.id, createdBy: teacher.id },
      select: { id: true },
    });
    await setup.assetAttachment.create({
      data: { assetId: tempAsset.id, entityType: "lesson_resource", entityId: tempResource.id, attachedBy: teacher.id },
    });

    const deletedByOutsider = await asContext(
      { userId: outsiderTeacher.id, permissions: ["courses.content.write"] },
      (tx) => tx.assetAttachment.deleteMany({ where: { entityType: "lesson_resource", entityId: tempResource.id } })
    );
    expect(deletedByOutsider.count).toBe(0);

    const deletedByTeacher = await asContext({ userId: teacher.id, permissions: ["courses.content.write"] }, (tx) =>
      tx.assetAttachment.deleteMany({ where: { entityType: "lesson_resource", entityId: tempResource.id } })
    );
    expect(deletedByTeacher.count).toBe(1);

    await setup.resource.delete({ where: { id: tempResource.id } });
    await setup.asset.delete({ where: { id: tempAsset.id } });
    await setup.$disconnect();
  });
});
