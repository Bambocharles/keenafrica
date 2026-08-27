import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, requirePermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent, onDomainEvent } from "@/lib/events";
import { actorRlsCtx, isCourseTeacher } from "@/lib/courses";
import { uploadAsset } from "@/lib/assets";

/**
 * Certificates (Session 14). See sessions/14-certificates.md.
 *
 * Eligibility is owned entirely by Progress (Session 08) — the ONLY signal
 * checked below is `enrollments.status = 'completed'`, the exact column
 * recalculateCourseProgress() computes and durably writes
 * (src/lib/progress.ts). This module never counts lessons, published
 * modules, or anything else Progress already computed — see
 * issueCertificateIfEligible()'s single Enrollment read.
 *
 * Trigger, not a button: the ONE reliable call site is
 * src/app/student/(protected)/courses/[courseId]/lessons/[lessonId]/actions.ts's
 * markLessonCompleteAction, immediately after it AWAITS markLessonComplete()
 * — the exact moment Progress guarantees Enrollment.status is freshly
 * recomputed and committed (markLessonComplete itself awaits
 * recalculateCourseProgress() before returning). There is no "Issue
 * Certificate" button anywhere; issuance is a side effect of a real
 * completion action meeting a criterion this module only ever reads.
 *
 * This module ALSO self-subscribes to LessonCompleted below, the same
 * "harmless redundant re-run" safety-net precedent progress.ts itself
 * established for that event — a genuine race exists there (the listener
 * can fire before the recalculation that the SAME event triggers elsewhere
 * has committed), so it is deliberately NOT the primary trigger, only a
 * best-effort backstop for any future completion path that doesn't go
 * through the one call site above.
 *
 * Forgery resistance: issueCertificateIfEligible() is the ONLY function
 * that writes a certificates row, and it always writes under
 * systemCertificateCtx() — a narrow synthesized RLS context holding only
 * `certificates.manage`, never a real actor's own permission set (mirrors
 * progress.ts's systemProgressCtx()). No STUDENT or TEACHER role holds
 * `certificates.manage` (src/lib/authz.ts), so certificates_write/update's
 * RLS policy rejects any real actor's direct write attempt regardless of
 * application-layer bugs — see docs/CERTIFICATES.md.
 */

function systemCertificateCtx(studentUserId: string) {
  return { userId: studentUserId, isSuperAdmin: false, permissions: [PERMISSIONS.CERTIFICATES_MANAGE] };
}

function generateCertificateNumber(): string {
  const year = new Date().getFullYear();
  const random = randomBytes(6).toString("hex").toUpperCase();
  return `KA-${year}-${random}`;
}

export interface CertificateRecord {
  id: string;
  studentUserId: string;
  courseId: string;
  enrollmentId: string;
  certificateNumber: string;
  status: "active" | "revoked";
  templateVersion: number;
  studentNameSnapshot: string;
  courseTitleSnapshot: string;
  completedAt: Date;
  issuedAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * The ONLY path that creates a Certificate row. Self-scoped by construction
 * (actor.id is always the student being checked) — see this module's
 * header for the call-site/backstop split and the exact eligibility rule.
 * A no-op (returns null) for a not-yet-eligible student — this is expected
 * to be called after every lesson completion, most of which won't yet meet
 * the criterion. Idempotent — an already-issued certificate is returned
 * as-is, never duplicated or re-issued (@@unique([studentUserId, courseId])
 * is the DB-level backstop for the redundant-listener race described
 * above).
 */
export async function issueCertificateIfEligible(courseId: string, actor: AuthzActor): Promise<CertificateRecord | null> {
  const enrollment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.enrollment.findFirst({
      where: { studentUserId: actor.id, status: "completed", cohort: { courseId } },
      orderBy: { completedAt: "desc" },
    })
  );
  if (!enrollment) return null;

  const existing = await withRls(actorRlsCtx(actor), (tx) =>
    tx.certificate.findUnique({ where: { studentUserId_courseId: { studentUserId: actor.id, courseId } } })
  );
  if (existing) return existing;

  const [student, course] = await withRls(actorRlsCtx(actor), (tx) =>
    Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } }),
      tx.course.findUniqueOrThrow({ where: { id: courseId }, select: { title: true } }),
    ])
  );

  const ctx = systemCertificateCtx(actor.id);
  let certificate: CertificateRecord | null = null;

  for (let attempt = 0; attempt < 3 && !certificate; attempt++) {
    try {
      certificate = await withRls(ctx, (tx) =>
        tx.certificate.create({
          data: {
            studentUserId: actor.id,
            courseId,
            enrollmentId: enrollment.id,
            certificateNumber: generateCertificateNumber(),
            studentNameSnapshot: student.name,
            courseTitleSnapshot: course.title,
            // recalculateCourseProgress() always sets completedAt together
            // with status='completed' in the same write — the fallback
            // below only guards against that invariant somehow not holding.
            completedAt: enrollment.completedAt ?? new Date(),
          },
        })
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Either the (studentUserId, courseId) race (a concurrent caller won)
      // or the astronomically-unlikely certificateNumber collision. Check
      // for the former first — if it's there, we're done; otherwise retry
      // with a freshly generated number.
      const raced = await withRls(actorRlsCtx(actor), (tx) =>
        tx.certificate.findUnique({ where: { studentUserId_courseId: { studentUserId: actor.id, courseId } } })
      );
      if (raced) return raced;
      if (attempt === 2) throw err;
    }
  }
  if (!certificate) throw new Error("Failed to issue certificate");

  await recordAuditEvent({
    actorId: actor.id,
    action: "certificate.issued",
    entityType: "Certificate",
    entityId: certificate.id,
    metadata: { courseId, certificateNumber: certificate.certificateNumber },
  });
  emitDomainEvent("CertificateIssued", { certificateId: certificate.id, studentId: actor.id });

  await attachDownloadableCertificate(certificate).catch((err) => {
    console.error("[certificates] failed to generate downloadable file", err);
  });

  return certificate;
}

// Best-effort safety net — see this module's header for why this is
// deliberately NOT the reliable trigger.
onDomainEvent("LessonCompleted", async ({ courseId, studentId }) => {
  const actor: AuthzActor = { id: studentId, isSuperAdmin: false, permissions: [] };
  await issueCertificateIfEligible(courseId, actor);
});

function renderCertificateText(certificate: CertificateRecord): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return [
    "KEEN AFRICA -- CERTIFICATE OF COMPLETION",
    "",
    `This certifies that ${certificate.studentNameSnapshot}`,
    `has successfully completed the course "${certificate.courseTitleSnapshot}".`,
    "",
    `Completed on: ${fmt(certificate.completedAt)}`,
    `Issued on: ${fmt(certificate.issuedAt)}`,
    `Certificate number: ${certificate.certificateNumber}`,
    "",
    "This certificate reflects the course-completion status recorded at the",
    "time of issuance and remains a stable historical record regardless of",
    "any later changes to the course's content.",
    "",
    "An authorized staff member can verify this certificate's authenticity",
    "by its certificate number through the Keen Africa admin console.",
  ].join("\n");
}

/**
 * Owns list: "optional downloadable certificate through Asset service" —
 * generated once, eagerly, at issuance. Uses the REAL student actor for the
 * Asset row itself (assets_write's RLS policy only requires
 * uploader_id = the caller's own app.user_id, which this satisfies
 * trivially and needs no elevated permission), then the elevated
 * systemCertificateCtx for the AssetAttachment row (asset_attachments_write
 * has no self-service branch for entity_type='certificate' — only the
 * certificates.manage bypass, per the certificates_asset_attachments
 * migration).
 */
async function attachDownloadableCertificate(certificate: CertificateRecord): Promise<void> {
  const buffer = Buffer.from(renderCertificateText(certificate), "utf-8");
  // assets_write's RLS policy only requires uploader_id = the caller's own
  // app.user_id, satisfied trivially by uploading AS the certificate's
  // student — no elevated permission needed for this half of the write.
  const uploadActor: AuthzActor = { id: certificate.studentUserId, isSuperAdmin: false, permissions: [] };
  const asset = await uploadAsset(
    {
      originalFilename: `certificate-${certificate.certificateNumber}.txt`,
      declaredMimeType: "text/plain",
      buffer,
    },
    uploadActor
  );

  await withRls(systemCertificateCtx(certificate.studentUserId), (tx) =>
    tx.assetAttachment.create({
      data: {
        assetId: asset.id,
        entityType: "certificate",
        entityId: certificate.id,
        attachedBy: certificate.studentUserId,
      },
    })
  );
}

async function findDownloadAssetId(certificateId: string, actor: AuthzActor): Promise<string | null> {
  const attachment = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assetAttachment.findFirst({
      where: { entityType: "certificate", entityId: certificateId },
      select: { assetId: true },
    })
  );
  return attachment?.assetId ?? null;
}

export interface CertificateView extends CertificateRecord {
  downloadAssetId: string | null;
}

/** Self-scoped: the acting student's own issued certificates, newest first. */
export async function listMyCertificates(actor: AuthzActor): Promise<CertificateView[]> {
  const certificates = await withRls(actorRlsCtx(actor), (tx) =>
    tx.certificate.findMany({ where: { studentUserId: actor.id }, orderBy: { issuedAt: "desc" } })
  );
  return Promise.all(
    certificates.map(async (c) => ({ ...c, downloadAssetId: await findDownloadAssetId(c.id, actor) }))
  );
}

/**
 * Authorized read of a single certificate — self, the course's teacher, or
 * certificates.manage/super_admin (mirrors certificates_select's RLS
 * policy exactly; the DB is the real backstop, this just gives callers a
 * clean 404-vs-403-shaped result instead of relying on RLS alone to hide
 * the row).
 */
export async function getCertificateById(id: string, actor: AuthzActor): Promise<CertificateView | null> {
  const certificate = await withRls(actorRlsCtx(actor), (tx) => tx.certificate.findUnique({ where: { id } }));
  if (!certificate) return null;

  const authorized =
    actor.isSuperAdmin ||
    hasPermission(actor, PERMISSIONS.CERTIFICATES_MANAGE) ||
    certificate.studentUserId === actor.id ||
    (await isCourseTeacher(certificate.courseId, actor));
  if (!authorized) return null;

  return { ...certificate, downloadAssetId: await findDownloadAssetId(certificate.id, actor) };
}

/**
 * Admin verification — "authorized staff can verify it" (acceptance
 * criterion). Requires certificates.manage/super_admin explicitly (not just
 * relying on RLS silently returning nothing to an unauthorized caller), so
 * the caller gets a clear AuthorizationError rather than an ambiguous
 * "not found" for a real certificate they simply aren't allowed to see.
 */
export async function verifyCertificateByNumber(
  certificateNumber: string,
  actor: AuthzActor
): Promise<CertificateView | null> {
  requirePermission(actor, PERMISSIONS.CERTIFICATES_MANAGE);
  const certificate = await withRls(actorRlsCtx(actor), (tx) =>
    tx.certificate.findUnique({ where: { certificateNumber: certificateNumber.trim() } })
  );
  if (!certificate) return null;
  return { ...certificate, downloadAssetId: await findDownloadAssetId(certificate.id, actor) };
}

/**
 * Admin management — revocation is a status flip, never a row delete (no
 * DELETE RLS policy exists for certificates at all). Requires
 * certificates.manage/super_admin.
 */
export async function revokeCertificate(id: string, reason: string, actor: AuthzActor): Promise<CertificateRecord> {
  requirePermission(actor, PERMISSIONS.CERTIFICATES_MANAGE);

  const certificate = await withRls(actorRlsCtx(actor), (tx) => tx.certificate.findUnique({ where: { id } }));
  if (!certificate) throw new AuthorizationError("Certificate not found");
  if (certificate.status === "revoked") return certificate;

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.certificate.update({
      where: { id },
      data: { status: "revoked", revokedAt: new Date(), revokedBy: actor.id, revokedReason: reason.trim() || null },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "certificate.revoked",
    entityType: "Certificate",
    entityId: id,
    metadata: { reason: updated.revokedReason },
  });

  return updated;
}

/** Admin management — recent issuances across all students/courses, newest first. Requires certificates.manage/super_admin. */
export async function listRecentCertificates(actor: AuthzActor, limit = 50): Promise<CertificateView[]> {
  requirePermission(actor, PERMISSIONS.CERTIFICATES_MANAGE);
  const certificates = await withRls(actorRlsCtx(actor), (tx) =>
    tx.certificate.findMany({ orderBy: { issuedAt: "desc" }, take: limit })
  );
  return Promise.all(
    certificates.map(async (c) => ({ ...c, downloadAssetId: await findDownloadAssetId(c.id, actor) }))
  );
}
