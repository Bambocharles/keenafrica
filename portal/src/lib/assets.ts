import { randomUUID, createHash } from "node:crypto";
import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { actorRlsCtx, isCourseTeacher, assertActiveEnrollment } from "@/lib/courses";
import { getStorageDriver } from "@/lib/storage";

/**
 * Asset/File service — Session 13 (Files & Content Assets),
 * PLATFORM_ARCHITECTURE.md §11. The ONE canonical file/upload system for the
 * whole platform: course resources today (src/lib/content.ts), message/
 * sponsor-document/certificate attachments once Sessions 09/11/14 land, all
 * as one Asset row + one AssetAttachment row. Do not build a parallel
 * TeacherFiles/StudentFiles/SponsorFiles table for a new consumer — add an
 * AssetEntityType value (migration) + a case in canAccessAssetAttachment()
 * below instead.
 *
 * Ownership/visibility model:
 * - The uploader always sees/downloads their own asset (uploaderId).
 * - super_admin always can.
 * - Otherwise, visibility is derived ENTIRELY from what the asset is
 *   attached to (AssetAttachment) — an unattached asset nobody else
 *   uploaded is invisible to everyone but its uploader. This mirrors
 *   src/lib/content.ts's own read rules exactly for "lesson_resource"
 *   (course teacher/courses.manage/super_admin see any status; a student
 *   sees it only once the owning lesson+module are published AND they
 *   hold an active/completed enrollment) rather than inventing a second
 *   visibility rule for the same data.
 *
 * See docs/ASSETS.md for the full contract.
 */

export class UnsupportedFileTypeError extends Error {
  constructor(message = "Unsupported file type") {
    super(message);
    this.name = "UnsupportedFileTypeError";
  }
}

export class FileTooLargeError extends Error {
  constructor(message = "File exceeds the maximum allowed size") {
    super(message);
    this.name = "FileTooLargeError";
  }
}

export class AssetNotFoundError extends Error {
  constructor(message = "Asset not found") {
    super(message);
    this.name = "AssetNotFoundError";
  }
}

const DEFAULT_MAX_SIZE_BYTES = 26_214_400; // 25 MiB
export function maxAssetSizeBytes(): number {
  const raw = process.env.ASSET_MAX_SIZE_BYTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SIZE_BYTES;
}

/**
 * Allowlisted MIME types this service will accept, and a best-effort
 * content-based (magic-byte) check for each — never trust the
 * client-declared File.type alone (CLAUDE_BUILD_RULES.md §6 "validate
 * uploads"). This is a practical, dependency-free sniff, not an exhaustive
 * file-format parser; real malware/structural-exploit scanning needs
 * dedicated infrastructure (e.g. ClamAV) that doesn't exist yet — see
 * docs/ASSETS.md's Known limitations.
 */
type Sniffer = (buf: Buffer) => boolean;

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

const isPdf: Sniffer = (buf) => startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const isPng: Sniffer = (buf) => startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg: Sniffer = (buf) => startsWith(buf, [0xff, 0xd8, 0xff]);
const isGif: Sniffer = (buf) => startsWith(buf, [0x47, 0x49, 0x46, 0x38]); // "GIF8"
const isWebpImage: Sniffer = (buf) =>
  startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8); // "RIFF"...."WEBP"
// docx/pptx/xlsx are all ZIP containers.
const isZipContainer: Sniffer = (buf) =>
  startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buf, [0x50, 0x4b, 0x07, 0x08]);
const isMp4: Sniffer = (buf) => buf.length >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp";
const isWebm: Sniffer = (buf) => startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]);
// No reliable magic bytes for plain text — reject anything that looks like
// binary data instead (a NUL byte in the first 512 bytes is not valid text).
const isPlainText: Sniffer = (buf) => !buf.subarray(0, 512).includes(0);

const ALLOWED_MIME_TYPES: Record<string, Sniffer> = {
  "application/pdf": isPdf,
  "image/png": isPng,
  "image/jpeg": isJpeg,
  "image/gif": isGif,
  "image/webp": isWebpImage,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZipContainer,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZipContainer,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZipContainer,
  "video/mp4": isMp4,
  "video/webm": isWebm,
  "text/plain": isPlainText,
  "text/csv": isPlainText,
};

/**
 * Validates size + declared MIME type + magic-byte content, throwing a
 * typed error on failure. Returns the confirmed MIME type (always the
 * caller's declared type, once content-verified — this service never tries
 * to "correct" a mismatched declaration, only reject it).
 */
function validateUpload(declaredMimeType: string, buffer: Buffer): string {
  if (buffer.length === 0) throw new UnsupportedFileTypeError("Empty file");
  if (buffer.length > maxAssetSizeBytes()) throw new FileTooLargeError();

  const sniff = ALLOWED_MIME_TYPES[declaredMimeType];
  if (!sniff) throw new UnsupportedFileTypeError(`MIME type not allowed: ${declaredMimeType}`);
  if (!sniff(buffer)) throw new UnsupportedFileTypeError("File content does not match its declared type");

  return declaredMimeType;
}

export interface UploadAssetInput {
  originalFilename: string;
  declaredMimeType: string;
  buffer: Buffer;
}

/**
 * The one generic "store bytes, get back a canonical Asset row" primitive.
 * Does NOT attach the asset to anything — callers (e.g.
 * src/lib/content.ts's addResourceFromUpload) create the AssetAttachment
 * row themselves, in the same transaction as whatever business entity
 * they're wiring it to. Storage-write and DB-insert can't share one
 * transaction (Postgres has no concept of the filesystem write), so on a
 * DB-insert failure the just-written bytes are removed best-effort.
 */
export async function uploadAsset(input: UploadAssetInput, actor: AuthzActor) {
  const mimeType = validateUpload(input.declaredMimeType, input.buffer);
  const checksumSha256 = createHash("sha256").update(input.buffer).digest("hex");
  const storageKey = randomUUID();
  const driver = getStorageDriver();

  await driver.put(storageKey, input.buffer);

  try {
    const asset = await withRls(actorRlsCtx(actor), (tx) =>
      tx.asset.create({
        data: {
          uploaderId: actor.id,
          originalFilename: input.originalFilename.slice(0, 255),
          mimeType,
          sizeBytes: input.buffer.length,
          storageDriver: process.env.STORAGE_DRIVER ?? "local",
          storageKey,
          checksumSha256,
        },
      })
    );

    await recordAuditEvent({
      actorId: actor.id,
      action: "asset.uploaded",
      entityType: "Asset",
      entityId: asset.id,
      metadata: { originalFilename: asset.originalFilename, mimeType, sizeBytes: asset.sizeBytes },
    });

    return asset;
  } catch (err) {
    await driver.delete(storageKey).catch(() => {});
    throw err;
  }
}

/**
 * Per-entityType visibility check for an AssetAttachment. Only
 * "lesson_resource" exists today. Sessions 09/11/14 add their own case
 * here (and their own AssetEntityType value) rather than a parallel
 * mechanism — see this file's header.
 */
async function canAccessAssetAttachment(entityType: string, entityId: string, actor: AuthzActor): Promise<boolean> {
  if (entityType !== "lesson_resource") return false;

  const resource = await withRls(actorRlsCtx(actor), (tx) =>
    tx.resource.findUnique({
      where: { id: entityId },
      select: {
        lesson: {
          select: {
            status: true,
            courseId: true,
            module: { select: { status: true } },
          },
        },
      },
    })
  );
  if (!resource) return false;

  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.COURSES_MANAGE)) return true;
  if (await isCourseTeacher(resource.lesson.courseId, actor)) return true;

  if (resource.lesson.status !== "published" || resource.lesson.module.status !== "published") return false;
  try {
    await assertActiveEnrollment(resource.lesson.courseId, actor);
    return true;
  } catch {
    return false;
  }
}

export async function canAccessAsset(assetId: string, actor: AuthzActor): Promise<boolean> {
  const asset = await withRls(actorRlsCtx(actor), (tx) => tx.asset.findUnique({ where: { id: assetId } }));
  if (!asset || asset.status === "deleted") return false;
  if (actor.isSuperAdmin || asset.uploaderId === actor.id) return true;

  const attachments = await withRls(actorRlsCtx(actor), (tx) =>
    tx.assetAttachment.findMany({ where: { assetId }, select: { entityType: true, entityId: true } })
  );
  for (const attachment of attachments) {
    if (await canAccessAssetAttachment(attachment.entityType, attachment.entityId, actor)) return true;
  }
  return false;
}

export interface AssetDownload {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

/** Throws AuthorizationError/AssetNotFoundError; never returns bytes to an unauthorized caller. */
export async function getAssetForDownload(assetId: string, actor: AuthzActor): Promise<AssetDownload> {
  const asset = await withRls(actorRlsCtx(actor), (tx) => tx.asset.findUnique({ where: { id: assetId } }));
  if (!asset || asset.status === "deleted") throw new AssetNotFoundError();

  if (!(await canAccessAsset(assetId, actor))) throw new AuthorizationError("Not authorized");

  const buffer = await getStorageDriver().get(asset.storageKey);
  return { buffer, mimeType: asset.mimeType, filename: asset.originalFilename };
}

/**
 * The one shared download Response builder — every portal's
 * `assets/[id]/download/route.ts` (admin/teacher/student today) calls this
 * after its own auth()+portal-shell-gate check, so the actual
 * authorization/streaming logic lives in exactly one place. Route handlers
 * are NOT wrapped by their segment's layout.tsx guard in the Next.js App
 * Router (layouts only wrap rendered pages), so each route.ts must — and
 * does — perform its own auth check before calling this.
 */
export async function assetDownloadResponse(assetId: string, actor: AuthzActor): Promise<Response> {
  let download: AssetDownload;
  try {
    download = await getAssetForDownload(assetId, actor);
  } catch (err) {
    if (err instanceof AssetNotFoundError) return new Response("Not found", { status: 404 });
    if (err instanceof AuthorizationError) return new Response("Not authorized", { status: 403 });
    throw err;
  }

  // Strip CR/LF from the filename before it ever reaches a header value —
  // originalFilename is user-supplied (the uploader's own filename) and
  // this is the one place it's echoed back in an HTTP header.
  const safeName = download.filename.replace(/[\r\n"]/g, "_");
  return new Response(new Uint8Array(download.buffer), {
    status: 200,
    headers: {
      "Content-Type": download.mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(download.buffer.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Soft-deletes an asset (status='deleted', storage bytes purged) — never a
 * real row DELETE (no DELETE RLS policy exists for "assets" at all), and
 * only once every AssetAttachment referencing it is gone (callers detach
 * first — see content.ts's removeResource for the ordering this requires:
 * detach, THEN delete the owning row, THEN this).
 */
async function purgeOrphanedAsset(assetId: string, actor: AuthzActor): Promise<void> {
  const asset = await withRls(actorRlsCtx(actor), (tx) => tx.asset.findUnique({ where: { id: assetId } }));
  if (!asset || asset.status === "deleted") return;

  const remaining = await withRls(actorRlsCtx(actor), (tx) => tx.assetAttachment.count({ where: { assetId } }));
  if (remaining > 0) return;

  await getStorageDriver().delete(asset.storageKey).catch(() => {});
  await withRls(actorRlsCtx(actor), (tx) =>
    tx.asset.update({ where: { id: assetId }, data: { status: "deleted", deletedAt: new Date() } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "asset.deleted", entityType: "Asset", entityId: assetId });
}

/**
 * Actor-facing entry point: only the uploader or super_admin may delete
 * their own asset directly. For a future "remove my upload" UI action, not
 * used by this session's own content.ts flow (see
 * deleteAssetIfOrphanedAsContentOwner below).
 */
export async function deleteAssetIfOrphaned(assetId: string, actor: AuthzActor): Promise<void> {
  const asset = await withRls(actorRlsCtx(actor), (tx) => tx.asset.findUnique({ where: { id: assetId } }));
  if (!asset || asset.status === "deleted") return;
  if (!actor.isSuperAdmin && asset.uploaderId !== actor.id) {
    throw new AuthorizationError("Not authorized");
  }
  await purgeOrphanedAsset(assetId, actor);
}

/**
 * For callers (src/lib/content.ts's removeResource) that have ALREADY
 * authorized the actor against the specific business entity the asset was
 * attached to (e.g. requireCourseContentAccess ownership over the course) —
 * that authorization is equal-or-stronger than "is the uploader," so this
 * skips the uploader-identity re-check rather than requiring the acting
 * teacher to also happen to be who originally uploaded the file. Mirrors
 * src/lib/sessions.ts's revokeAllUserSessionsAsSystem "internal, for
 * already-authorized callers only" convention.
 */
export async function deleteAssetIfOrphanedAsContentOwner(assetId: string, actor: AuthzActor): Promise<void> {
  await purgeOrphanedAsset(assetId, actor);
}
