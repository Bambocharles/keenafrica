import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse } from "@/lib/courses";
import {
  addResource,
  addResourceFromUpload,
  createLesson,
  createModule,
  getCourseContentForStudent,
  getCourseContentForTeacher,
  publishLesson,
  publishModule,
  removeResource,
  reorderLessons,
  reorderModules,
  unpublishLesson,
  updateLesson,
} from "@/lib/content";
import { UnsupportedFileTypeError } from "@/lib/assets";
import { enrollStudent } from "@/lib/courses";
import { actorFromUser, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const MINIMAL_PDF = Buffer.from("%PDF-1.4\n%test pdf content for upload validation\n%%EOF");

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

/** Sets up Course + Cohort + an assigned teacher, ready for content authoring. */
async function setupCourseWithTeacher() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  return { admin, adminActor, course, cohort, teacher, teacherActor };
}

describe("createModule / createLesson — ownership boundary", () => {
  it("a teacher NOT assigned to the course cannot create a module", async () => {
    const { course } = await setupCourseWithTeacher();

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(createModule(course.id, { title: "Sneaky Module" }, outsiderActor)).rejects.toThrow(
      AuthorizationError
    );
  });

  it("the assigned teacher can create a module and a lesson within it, both defaulting to draft", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();

    const module = await createModule(course.id, { title: "Module 1" }, teacherActor);
    expect(module.status).toBe("draft");
    expect(module.order).toBe(0);

    const lesson = await createLesson(module.id, { title: "Lesson 1", content: "Hello" }, teacherActor);
    expect(lesson.status).toBe("draft");
    expect(lesson.courseId).toBe(course.id);
    expect(lesson.version).toBe(0);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "lesson.created", entityId: lesson.id } });
    expect(audit).not.toBeNull();
  });

  it("an admin (courses.manage) can create content on any course without a cohort assignment", async () => {
    const { course, adminActor } = await setupCourseWithTeacher();
    await expect(createModule(course.id, { title: "Admin Module" }, adminActor)).resolves.not.toThrow();
  });

  it("second module auto-increments order", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const m1 = await createModule(course.id, { title: "M1" }, teacherActor);
    const m2 = await createModule(course.id, { title: "M2" }, teacherActor);
    expect(m1.order).toBe(0);
    expect(m2.order).toBe(1);
  });
});

describe("reorderModules / reorderLessons", () => {
  it("reorders modules according to the given array", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const m1 = await createModule(course.id, { title: "M1" }, teacherActor);
    const m2 = await createModule(course.id, { title: "M2" }, teacherActor);

    await reorderModules(course.id, [m2.id, m1.id], teacherActor);

    const rows = await prisma.module.findMany({ where: { courseId: course.id }, orderBy: { order: "asc" } });
    expect(rows.map((r) => r.id)).toEqual([m2.id, m1.id]);
  });

  it("reorders lessons within a module", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const l1 = await createLesson(module.id, { title: "L1", content: "a" }, teacherActor);
    const l2 = await createLesson(module.id, { title: "L2", content: "b" }, teacherActor);

    await reorderLessons(module.id, [l2.id, l1.id], teacherActor);

    const rows = await prisma.lesson.findMany({ where: { moduleId: module.id }, orderBy: { order: "asc" } });
    expect(rows.map((r) => r.id)).toEqual([l2.id, l1.id]);
  });
});

describe("publishLesson — versioning foundation + ownership boundary", () => {
  it("an outsider teacher cannot publish", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "Draft body" }, teacherActor);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(publishLesson(lesson.id, outsiderActor)).rejects.toThrow(AuthorizationError);
  });

  it("publishing snapshots a LessonVersion, bumps version, and sets status=published", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "Draft body" }, teacherActor);

    await publishLesson(lesson.id, teacherActor);

    const row = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(row.status).toBe("published");
    expect(row.version).toBe(1);
    expect(row.publishedAt).not.toBeNull();

    const versions = await prisma.lessonVersion.findMany({ where: { lessonId: lesson.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].title).toBe("L1");
    expect(versions[0].content).toBe("Draft body");
  });

  it("editing after publish and republishing does not destroy the earlier version snapshot", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "v1 body" }, teacherActor);

    await publishLesson(lesson.id, teacherActor);
    await updateLesson(lesson.id, { content: "v2 body" }, teacherActor);
    await publishLesson(lesson.id, teacherActor);

    const versions = await prisma.lessonVersion.findMany({
      where: { lessonId: lesson.id },
      orderBy: { version: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0].content).toBe("v1 body");
    expect(versions[1].content).toBe("v2 body");

    const row = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(row.version).toBe(2);
  });

  it("unpublishLesson sets status back to draft without touching version history", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);
    await publishLesson(lesson.id, teacherActor);

    await unpublishLesson(lesson.id, teacherActor);

    const row = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(row.status).toBe("draft");

    const versions = await prisma.lessonVersion.count({ where: { lessonId: lesson.id } });
    expect(versions).toBe(1);
  });
});

describe("Resource — ownership boundary", () => {
  it("an outsider teacher cannot add a resource", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);
    await expect(
      addResource(lesson.id, { title: "External link", url: "https://example.com" }, outsiderActor)
    ).rejects.toThrow(AuthorizationError);
  });

  it("the assigned teacher can add and remove a resource", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const resource = await addResource(lesson.id, { title: "External link", url: "https://example.com" }, teacherActor);
    expect(resource.lessonId).toBe(lesson.id);

    await removeResource(resource.id, teacherActor);
    const row = await prisma.resource.findUnique({ where: { id: resource.id } });
    expect(row).toBeNull();
  });
});

describe("getCourseContentForTeacher vs getCourseContentForStudent — the visibility acceptance criterion", () => {
  it("teacher view includes draft modules/lessons; student view does not", async () => {
    const { course, cohort, teacherActor, adminActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const draftLesson = await createLesson(module.id, { title: "Draft Lesson", content: "secret draft" }, teacherActor);
    const publishedLesson = await createLesson(module.id, { title: "Published Lesson", content: "public" }, teacherActor);
    await publishModule(module.id, teacherActor);
    await publishLesson(publishedLesson.id, teacherActor);

    const teacherView = await getCourseContentForTeacher(course.id, teacherActor);
    const teacherLessonIds = teacherView!.modules.flatMap((m) => m.lessons.map((l) => l.id));
    expect(teacherLessonIds).toContain(draftLesson.id);
    expect(teacherLessonIds).toContain(publishedLesson.id);

    const student = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await actorFromUser(student.id);

    const studentView = await getCourseContentForStudent(course.id, studentActor);
    const studentLessonIds = studentView!.modules.flatMap((m) => m.lessons.map((l) => l.id));
    expect(studentLessonIds).not.toContain(draftLesson.id);
    expect(studentLessonIds).toContain(publishedLesson.id);
  });

  it("a student with no enrollment in the course is rejected outright", async () => {
    const { course } = await setupCourseWithTeacher();

    const unenrolledStudent = await user({ roles: ["STUDENT"] });
    const studentActor = await actorFromUser(unenrolledStudent.id);

    await expect(getCourseContentForStudent(course.id, studentActor)).rejects.toThrow(AuthorizationError);
  });
});

describe("addResourceFromUpload / removeResource — Session 13 Asset integration", () => {
  it("an assigned teacher can upload a file resource; it carries an assetId and no url", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const resource = await addResourceFromUpload(
      lesson.id,
      { title: "Slides", originalFilename: "slides.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      teacherActor
    );

    expect(resource.assetId).not.toBeNull();
    expect(resource.url).toBeNull();

    const asset = await prisma.asset.findUnique({ where: { id: resource.assetId! } });
    expect(asset?.status).toBe("active");
    expect(asset?.mimeType).toBe("application/pdf");

    const attachment = await prisma.assetAttachment.findUnique({
      where: { entityType_entityId: { entityType: "lesson_resource", entityId: resource.id } },
    });
    expect(attachment).not.toBeNull();
  });

  it("a teacher NOT assigned to the course cannot upload a resource, and no Asset row is left behind", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const outsider = await user({ roles: ["TEACHER"] });
    const outsiderActor = await actorFromUser(outsider.id);

    await expect(
      addResourceFromUpload(
        lesson.id,
        { title: "Slides", originalFilename: "slides.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
        outsiderActor
      )
    ).rejects.toThrow(AuthorizationError);

    const orphanCount = await prisma.asset.count({ where: { uploaderId: outsider.id } });
    expect(orphanCount).toBe(0);
  });

  it("rejects a file whose content doesn't match its declared MIME type", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    await expect(
      addResourceFromUpload(
        lesson.id,
        {
          title: "Fake PDF",
          originalFilename: "fake.pdf",
          declaredMimeType: "application/pdf",
          buffer: Buffer.from("this is not a pdf"),
        },
        teacherActor
      )
    ).rejects.toThrow(UnsupportedFileTypeError);
  });

  it("removeResource detaches and purges the underlying asset (storage bytes + row) once orphaned", async () => {
    const { course, teacherActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);

    const resource = await addResourceFromUpload(
      lesson.id,
      { title: "Slides", originalFilename: "slides.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      teacherActor
    );
    const assetId = resource.assetId!;

    await removeResource(resource.id, teacherActor);

    const resourceRow = await prisma.resource.findUnique({ where: { id: resource.id } });
    expect(resourceRow).toBeNull();

    const attachment = await prisma.assetAttachment.findUnique({
      where: { entityType_entityId: { entityType: "lesson_resource", entityId: resource.id } },
    });
    expect(attachment).toBeNull();

    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(asset?.status).toBe("deleted");
  });

  it("a student sees an uploaded resource only once its lesson/module are published and they are enrolled", async () => {
    const { course, cohort, teacherActor, adminActor } = await setupCourseWithTeacher();
    const module = await createModule(course.id, { title: "M1" }, teacherActor);
    const lesson = await createLesson(module.id, { title: "L1", content: "body" }, teacherActor);
    await addResourceFromUpload(
      lesson.id,
      { title: "Slides", originalFilename: "slides.pdf", declaredMimeType: "application/pdf", buffer: MINIMAL_PDF },
      teacherActor
    );

    const student = await user({ roles: ["STUDENT"] });
    await enrollStudent(cohort.id, student.id, adminActor);
    const studentActor = await actorFromUser(student.id);

    const beforePublish = await getCourseContentForStudent(course.id, studentActor);
    expect(beforePublish!.modules.flatMap((m) => m.lessons)).toHaveLength(0);

    await publishModule(module.id, teacherActor);
    await publishLesson(lesson.id, teacherActor);

    const afterPublish = await getCourseContentForStudent(course.id, studentActor);
    const resources = afterPublish!.modules.flatMap((m) => m.lessons).flatMap((l) => l.resources);
    expect(resources).toHaveLength(1);
    expect(resources[0].assetId).not.toBeNull();
  });
});
