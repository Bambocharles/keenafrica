import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import {
  AssetNotFoundError,
  FileTooLargeError,
  UnsupportedFileTypeError,
  canAccessAsset,
  getAssetForDownload,
  maxAssetSizeBytes,
  uploadAsset,
} from "@/lib/assets";
import { actorFromUser, cleanupTestAssets, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const MINIMAL_PDF = Buffer.from("%PDF-1.4\n%test pdf content\n%%EOF");

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdAssetIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  // Course-attached assets are cleaned up (attachment + resource + asset)
  // by cleanupTestCourses itself; run it first so cleanupTestAssets only
  // has to handle the standalone/never-attached assets left over.
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestAssets(createdAssetIds);
  await cleanupTestUsers(createdUserIds);
});

describe("uploadAsset — validation", () => {
  it("stores a well-formed PDF and returns a canonical Asset row", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const actor = await actorFromUser(teacher.id);

    const asset = await uploadAsset(
      { originalFilename: "notes.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      actor
    );
    createdAssetIds.push(asset.id);

    expect(asset.uploaderId).toBe(teacher.id);
    expect(asset.status).toBe("active");
    expect(asset.sizeBytes).toBe(MINIMAL_PDF.length);
    expect(asset.checksumSha256).toHaveLength(64);
  });

  it("rejects a MIME type not on the allowlist", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const actor = await actorFromUser(teacher.id);

    await expect(
      uploadAsset(
        { originalFilename: "script.exe", declaredMimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
        actor
      )
    ).rejects.toThrow(UnsupportedFileTypeError);
  });

  it("rejects content that doesn't match its declared MIME type (magic-byte mismatch)", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const actor = await actorFromUser(teacher.id);

    await expect(
      uploadAsset(
        { originalFilename: "fake.png", declaredMimeType: "image/png", buffer: Buffer.from("not a real png") },
        actor
      )
    ).rejects.toThrow(UnsupportedFileTypeError);
  });

  it("rejects a file over the configured size limit", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const actor = await actorFromUser(teacher.id);
    const oversized = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(maxAssetSizeBytes(), 0x20)]);

    await expect(
      uploadAsset({ originalFilename: "huge.pdf", declaredMimeType: "application/pdf", buffer: oversized }, actor)
    ).rejects.toThrow(FileTooLargeError);
  });
});

describe("canAccessAsset / getAssetForDownload — visibility & download authorization", () => {
  async function setupPublishedLessonWithAsset() {
    const admin = await user({ roles: ["ADMIN"] });
    const adminActor = await actorFromUser(admin.id);
    const course = await createCourse({ title: `Assets Course ${Date.now()}-${Math.random()}` }, adminActor);
    createdCourseIds.push(course.id);
    const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

    const teacher = await user({ roles: ["TEACHER"] });
    await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
    const teacherActor = await actorFromUser(teacher.id);

    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const asset = await uploadAsset(
      { originalFilename: "handout.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      teacherActor
    );
    createdAssetIds.push(asset.id);
    const resource = await prisma.resource.create({
      data: { lessonId: lesson.id, title: "Handout", type: "document", assetId: asset.id, createdBy: teacher.id },
    });
    await prisma.assetAttachment.create({
      data: { assetId: asset.id, entityType: "lesson_resource", entityId: resource.id, attachedBy: teacher.id },
    });

    return { admin, adminActor, course, cohort, teacher, teacherActor, module, lesson, asset };
  }

  it("the uploader can always access their own asset, even unattached", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const actor = await actorFromUser(teacher.id);
    const asset = await uploadAsset(
      { originalFilename: "solo.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      actor
    );
    createdAssetIds.push(asset.id);

    expect(await canAccessAsset(asset.id, actor)).toBe(true);
  });

  it("a stranger cannot access an unattached asset that isn't theirs", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const uploaderActor = await actorFromUser(teacher.id);
    const asset = await uploadAsset(
      { originalFilename: "solo.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      uploaderActor
    );
    createdAssetIds.push(asset.id);

    const stranger = await user({ roles: ["TEACHER"] });
    const strangerActor = await actorFromUser(stranger.id);

    expect(await canAccessAsset(asset.id, strangerActor)).toBe(false);
    await expect(getAssetForDownload(asset.id, strangerActor)).rejects.toThrow(AuthorizationError);
  });

  it("a course teacher can download a lesson_resource asset regardless of publish status", async () => {
    const { teacherActor, asset } = await setupPublishedLessonWithAsset();
    const download = await getAssetForDownload(asset.id, teacherActor);
    expect(download.mimeType).toBe("application/pdf");
    expect(download.buffer.equals(MINIMAL_PDF)).toBe(true);
  });

  it("an outsider teacher (not assigned to the course) cannot access the asset", async () => {
    const { asset } = await setupPublishedLessonWithAsset();
    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    expect(await canAccessAsset(asset.id, outsiderActor)).toBe(false);
    await expect(getAssetForDownload(asset.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("an enrolled student cannot download the asset while its lesson is still draft", async () => {
    const { cohort, adminActor, asset } = await setupPublishedLessonWithAsset();
    const student = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await actorFromUser(student.id);

    await expect(getAssetForDownload(asset.id, studentActor)).rejects.toThrow(AuthorizationError);
  });

  it("an enrolled student can download the asset once the lesson/module are published", async () => {
    const { cohort, adminActor, teacherActor, module, lesson, asset } = await setupPublishedLessonWithAsset();
    const student = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await actorFromUser(student.id);

    await publishModule(module.id, teacherActor);
    await publishLesson(lesson.id, teacherActor);

    const download = await getAssetForDownload(asset.id, studentActor);
    expect(download.buffer.equals(MINIMAL_PDF)).toBe(true);
  });

  it("an unenrolled student cannot download the asset even once published", async () => {
    const { teacherActor, module, lesson, asset } = await setupPublishedLessonWithAsset();
    await publishModule(module.id, teacherActor);
    await publishLesson(lesson.id, teacherActor);

    const outsiderStudent = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsiderStudent.id);

    await expect(getAssetForDownload(asset.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("a deleted/nonexistent asset raises AssetNotFoundError, not an authorization error", async () => {
    const teacher = await user({ roles: ["TEACHER"] });
    const actor = await actorFromUser(teacher.id);
    await expect(getAssetForDownload("00000000-0000-0000-0000-000000000000", actor)).rejects.toThrow(
      AssetNotFoundError
    );
  });
});
