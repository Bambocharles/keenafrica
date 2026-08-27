import { afterAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { assignTeacherToCohort, createCohort, createCourse, enrollStudent } from "@/lib/courses";
import { createLesson, createModule, publishLesson, publishModule } from "@/lib/content";
import { markLessonComplete } from "@/lib/progress";
import {
  getCertificateById,
  issueCertificateIfEligible,
  listMyCertificates,
  listRecentCertificates,
  revokeCertificate,
  verifyCertificateByNumber,
} from "@/lib/certificates";
import { actorFromUser, cleanupTestCertificates, cleanupTestCourses, cleanupTestUsers, createTestUser } from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

async function user(opts?: Parameters<typeof createTestUser>[0]) {
  const u = await createTestUser(opts);
  createdUserIds.push(u.id);
  return u;
}

afterAll(async () => {
  await cleanupTestCertificates(createdUserIds);
  await cleanupTestCourses(createdCourseIds);
  await cleanupTestUsers(createdUserIds);
});

/** Course with 2 published lessons in one module, one teacher, one enrolled student. */
async function setupCourseWithLessons() {
  const admin = await user({ roles: ["ADMIN"] });
  const adminActor = await actorFromUser(admin.id);
  const course = await createCourse({ title: `Cert Course ${Date.now()}-${Math.random()}` }, adminActor);
  createdCourseIds.push(course.id);
  const cohort = await createCohort(course.id, { name: "Cohort A" }, adminActor);

  const teacher = await user({ roles: ["TEACHER"] });
  await assignTeacherToCohort(cohort.id, teacher.id, adminActor);
  const teacherActor = await actorFromUser(teacher.id);

  const student = await user({ roles: ["STUDENT"] });
  await enrollStudent(cohort.id, student.id, adminActor);
  const studentActor = await actorFromUser(student.id);

  const module = await createModule(course.id, { title: "Module 1" }, teacherActor);
  await publishModule(module.id, teacherActor);
  const lessonA = await createLesson(module.id, { title: "Lesson A", content: "..." }, teacherActor);
  await publishLesson(lessonA.id, teacherActor);
  const lessonB = await createLesson(module.id, { title: "Lesson B", content: "..." }, teacherActor);
  await publishLesson(lessonB.id, teacherActor);

  return { admin, adminActor, course, cohort, teacher, teacherActor, student, studentActor, lessonA, lessonB };
}

describe("issueCertificateIfEligible", () => {
  it("is not eligible (returns null, issues nothing) until every published lesson is completed", async () => {
    const { course, lessonA, studentActor } = await setupCourseWithLessons();

    await markLessonComplete(course.id, lessonA.id, studentActor);
    // Only 1 of 2 lessons complete — Enrollment.status is still 'active',
    // not 'completed', so this reads that field and finds nothing to do.
    const result = await issueCertificateIfEligible(course.id, studentActor);
    expect(result).toBeNull();

    const mine = await listMyCertificates(studentActor);
    expect(mine).toHaveLength(0);
  });

  it("issues a certificate the moment Enrollment.status flips to 'completed', with stable snapshot fields", async () => {
    const { course, lessonA, lessonB, student, studentActor } = await setupCourseWithLessons();

    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);

    const certificate = await issueCertificateIfEligible(course.id, studentActor);
    expect(certificate).not.toBeNull();
    expect(certificate!.studentUserId).toBe(student.id);
    expect(certificate!.courseId).toBe(course.id);
    expect(certificate!.status).toBe("active");
    expect(certificate!.studentNameSnapshot).toBe(student.name);
    expect(certificate!.courseTitleSnapshot).toContain("Cert Course");
    expect(certificate!.certificateNumber).toMatch(/^KA-\d{4}-[0-9A-F]{12}$/);

    // A downloadable file was generated and attached (Owns: "optional
    // downloadable certificate through Asset service").
    const view = await getCertificateById(certificate!.id, studentActor);
    expect(view!.downloadAssetId).not.toBeNull();
  });

  it("is idempotent — re-checking an already-certified student never creates a second row", async () => {
    const { course, lessonA, lessonB, studentActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);

    const first = await issueCertificateIfEligible(course.id, studentActor);
    const second = await issueCertificateIfEligible(course.id, studentActor);
    expect(second!.id).toBe(first!.id);

    const mine = await listMyCertificates(studentActor);
    expect(mine).toHaveLength(1);
  });

  it("never exposes a certificate to a student who has not met the criterion (Must NOT)", async () => {
    const { course, lessonA, studentActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);

    const mine = await listMyCertificates(studentActor);
    expect(mine).toHaveLength(0);
  });
});

describe("certificate visibility", () => {
  async function issuedCertificate() {
    const setup = await setupCourseWithLessons();
    await markLessonComplete(setup.course.id, setup.lessonA.id, setup.studentActor);
    await markLessonComplete(setup.course.id, setup.lessonB.id, setup.studentActor);
    const certificate = (await issueCertificateIfEligible(setup.course.id, setup.studentActor))!;
    return { ...setup, certificate };
  }

  it("is visible to the owning student, the course's teacher, and admin — not to an unrelated student", async () => {
    const { certificate, studentActor, teacherActor, adminActor } = await issuedCertificate();

    expect(await getCertificateById(certificate.id, studentActor)).not.toBeNull();
    expect(await getCertificateById(certificate.id, teacherActor)).not.toBeNull();
    expect(await getCertificateById(certificate.id, adminActor)).not.toBeNull();

    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);
    expect(await getCertificateById(certificate.id, outsiderActor)).toBeNull();
  });

  it("listMyCertificates is self-scoped — a different student's list never includes it", async () => {
    const { certificate } = await issuedCertificate();
    const outsider = await user({ roles: ["STUDENT"] });
    const outsiderActor = await actorFromUser(outsider.id);

    const outsiderList = await listMyCertificates(outsiderActor);
    expect(outsiderList.find((c) => c.id === certificate.id)).toBeUndefined();
  });
});

describe("verifyCertificateByNumber", () => {
  it("requires certificates.manage — a plain student cannot verify (authorized staff only)", async () => {
    const { course, lessonA, lessonB, studentActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);
    const certificate = (await issueCertificateIfEligible(course.id, studentActor))!;

    await expect(verifyCertificateByNumber(certificate.certificateNumber, studentActor)).rejects.toThrow(AuthorizationError);
  });

  it("lets an admin verify a real certificate number and rejects an unknown one", async () => {
    const { course, lessonA, lessonB, studentActor, adminActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);
    const certificate = (await issueCertificateIfEligible(course.id, studentActor))!;

    const found = await verifyCertificateByNumber(certificate.certificateNumber, adminActor);
    expect(found!.id).toBe(certificate.id);

    const notFound = await verifyCertificateByNumber("KA-0000-NOTAREALONE00", adminActor);
    expect(notFound).toBeNull();
  });
});

describe("revokeCertificate", () => {
  it("requires certificates.manage — the certificate's own student cannot revoke it", async () => {
    const { course, lessonA, lessonB, studentActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);
    const certificate = (await issueCertificateIfEligible(course.id, studentActor))!;

    await expect(revokeCertificate(certificate.id, "self-revoke attempt", studentActor)).rejects.toThrow(AuthorizationError);
  });

  it("lets an admin revoke, auditably, without deleting the historical row", async () => {
    const { course, lessonA, lessonB, studentActor, adminActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);
    const certificate = (await issueCertificateIfEligible(course.id, studentActor))!;

    const revoked = await revokeCertificate(certificate.id, "issued in error", adminActor);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedBy).toBe(adminActor.id);
    expect(revoked.revokedReason).toBe("issued in error");

    // Still readable — revocation is a status flip, not a deletion.
    const stillThere = await getCertificateById(certificate.id, studentActor);
    expect(stillThere!.status).toBe("revoked");
  });
});

describe("listRecentCertificates", () => {
  it("requires certificates.manage", async () => {
    const { course, lessonA, lessonB, studentActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);
    await issueCertificateIfEligible(course.id, studentActor);

    await expect(listRecentCertificates(studentActor)).rejects.toThrow(AuthorizationError);
  });

  it("lists issued certificates for an admin", async () => {
    const { course, lessonA, lessonB, studentActor, adminActor } = await setupCourseWithLessons();
    await markLessonComplete(course.id, lessonA.id, studentActor);
    await markLessonComplete(course.id, lessonB.id, studentActor);
    const certificate = (await issueCertificateIfEligible(course.id, studentActor))!;

    const recent = await listRecentCertificates(adminActor);
    expect(recent.find((c) => c.id === certificate.id)).toBeDefined();
  });
});
