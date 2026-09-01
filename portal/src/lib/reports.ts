import type { ReportEntityType, ReportStatus } from "@prisma/client";
import { withRls } from "@/lib/rls";
import { PERMISSIONS, requirePermission, type AuthzActor } from "@/lib/authz";
import { actorRlsCtx } from "@/lib/courses";
import { recordAuditEvent } from "@/lib/audit";
import { countRecentAuditEvents } from "@/lib/rate-limit";

/**
 * Admin Moderation, Reporting & Verification Review (Session 41). A real
 * reporting mechanism for Keen Africans articles/profiles — see
 * schema.prisma's Report comment for the data-model reasoning and
 * docs/KEEN_AFRICANS.md for the full contract.
 *
 * Reviewing a report (listReports/resolveReport/dismissReport) requires
 * articles.manage — the existing Keen Africans moderation key, not a new
 * one, per this session's own "Must NOT build a new permission system"
 * rule. Creating a report (createReport) requires NO permission at all and
 * works for a genuinely anonymous caller (no AuthzActor) — enforced at the
 * RLS layer too (reports_write's unconditional WITH CHECK (true), same
 * shape as audit_events_write) — the actual abuse boundary is the rate
 * limiter below, not an authorization check.
 */

export class ReportTargetNotFoundError extends Error {
  constructor(message = "That article or profile could not be found") {
    super(message);
    this.name = "ReportTargetNotFoundError";
  }
}

export class ReportRateLimitedError extends Error {
  constructor(message = "Too many reports submitted recently — try again later") {
    super(message);
    this.name = "ReportRateLimitedError";
  }
}

export class ReportNotFoundError extends Error {
  constructor(message = "Report not found") {
    super(message);
    this.name = "ReportNotFoundError";
  }
}

export class InvalidReportTransitionError extends Error {
  constructor(message = "That report has already been reviewed") {
    super(message);
    this.name = "InvalidReportTransitionError";
  }
}

// --- Rate limiting (this session's explicit rule: reuse rate-limit.ts) ---
//
// Dual per-account/per-IP windows, same shape as isLoginRateLimited() in
// src/lib/rate-limit.ts — a logged-in reporter is bounded by account, an
// anonymous one (or a logged-in one rotating accounts) is bounded by IP.
// Deliberately generous — this guards the report mechanism itself from
// becoming an abuse vector (spamming the moderation queue, or using mass
// false reports to harass an author), not against a genuinely concerned
// reader filing more than a couple of reports.
export const REPORT_ACCOUNT_WINDOW = { windowMs: 60 * 60 * 1000, maxAttempts: 5 };
export const REPORT_IP_WINDOW = { windowMs: 60 * 60 * 1000, maxAttempts: 8 };

async function assertNotRateLimited(actorId: string | null, ipAddress: string | null): Promise<void> {
  const [accountCount, ipCount] = await Promise.all([
    actorId
      ? countRecentAuditEvents({ actions: ["report.created"], actorId, sinceMs: REPORT_ACCOUNT_WINDOW.windowMs })
      : Promise.resolve(0),
    ipAddress
      ? countRecentAuditEvents({ actions: ["report.created"], ipAddress, sinceMs: REPORT_IP_WINDOW.windowMs })
      : Promise.resolve(0),
  ]);
  if (accountCount >= REPORT_ACCOUNT_WINDOW.maxAttempts || ipCount >= REPORT_IP_WINDOW.maxAttempts) {
    throw new ReportRateLimitedError();
  }
}

// --- Create (anonymous-capable) --------------------------------------

/**
 * Session 43 (Comments & Reactions) extends this with a third
 * entityType — 'comment' — per that session's own explicit "comments are
 * reportable through Session 41's existing mechanism" requirement. A
 * comment that's already been soft-deleted (see src/lib/comments.ts) is
 * treated as not-found here — nothing left to report.
 */
async function assertTargetExists(entityType: ReportEntityType, entityId: string): Promise<void> {
  const exists =
    entityType === "article"
      ? await withRls({}, (tx) => tx.article.findUnique({ where: { id: entityId }, select: { id: true } }))
      : entityType === "profile"
        ? await withRls({}, (tx) => tx.profile.findUnique({ where: { userId: entityId }, select: { id: true } }))
        : await withRls({}, (tx) => tx.comment.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } }));
  if (!exists) throw new ReportTargetNotFoundError();
}

/** The AuditEvent entityType for a given ReportEntityType — 'article'/'profile' map to the Article/User rows they key on directly; 'comment' reports its own Comment id. */
function auditEntityType(entityType: ReportEntityType): string {
  if (entityType === "article") return "Article";
  if (entityType === "profile") return "User";
  return "Comment";
}

export interface CreateReportInput {
  entityType: ReportEntityType;
  entityId: string;
  reason: string;
}

/**
 * Anyone — including an anonymous reader (actor === null) — may file a
 * report. `entityId` is the Article's id for entityType 'article', the
 * target User's id for entityType 'profile' (matching how every other
 * Keen Africans moderation surface — suspension, verification — keys on
 * userId, not Profile's own row id), or the Comment's own id for
 * entityType 'comment' (Session 43).
 */
export async function createReport(
  input: CreateReportInput,
  actor: AuthzActor | null,
  ipAddress: string | null
): Promise<void> {
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) throw new Error("A reason is required");

  await assertNotRateLimited(actor?.id ?? null, ipAddress);
  await assertTargetExists(input.entityType, input.entityId);

  // Public, unconditional INSERT (see reports_write's own comment) — but a
  // plain tx.report.create() issues INSERT ... RETURNING, and Postgres RLS
  // additionally enforces the SELECT policy (reports_select — articles.
  // manage/super_admin only) on any row returned by an INSERT, which would
  // reject exactly the anonymous/unprivileged callers this is supposed to
  // allow. $executeRaw issues a plain INSERT with no RETURNING, so only the
  // (unconditional) INSERT policy applies — same fix, same reasoning, as
  // src/lib/audit.ts's recordAuditEvent() documents for the identical
  // audit_events_write shape.
  await withRls(actor ? actorRlsCtx(actor) : {}, (tx) =>
    tx.$executeRaw`
      INSERT INTO reports (entity_type, entity_id, reporter_id, reason)
      VALUES (${input.entityType}::"ReportEntityType", ${input.entityId}::uuid, ${actor?.id ?? null}::uuid, ${reason})
    `
  );

  await recordAuditEvent({
    actorId: actor?.id ?? null,
    action: "report.created",
    entityType: auditEntityType(input.entityType),
    entityId: input.entityId,
    ipAddress,
  });
}

// --- Reviewer queue + decisions (articles.manage) -----------------------

export interface ListReportsFilter {
  status?: ReportStatus;
  entityType?: ReportEntityType;
}

export interface ReportSummary {
  id: string;
  entityType: ReportEntityType;
  entityId: string;
  reason: string;
  status: ReportStatus;
  reporterId: string | null;
  reporterEmail: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: Date;
}

export async function listReports(actor: AuthzActor, filter: ListReportsFilter = {}): Promise<ReportSummary[]> {
  requirePermission(actor, PERMISSIONS.ARTICLES_MANAGE);

  const rows = await withRls(actorRlsCtx(actor), (tx) =>
    tx.report.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { reporter: { select: { email: true } } },
    })
  );

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    reason: r.reason,
    status: r.status,
    reporterId: r.reporterId,
    reporterEmail: r.reporter?.email ?? null,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy,
    reviewNote: r.reviewNote,
    createdAt: r.createdAt,
  }));
}

/**
 * Batch lookup of entity ids with at least one PENDING report — backs
 * src/lib/articles.ts's listArticlesForModeration()'s `reportedOnly`
 * filter. articles.manage-gated (same as everything else in this module)
 * since it's only ever called from that admin-facing query.
 */
export async function getOpenReportEntityIds(entityType: ReportEntityType, actor: AuthzActor): Promise<Set<string>> {
  requirePermission(actor, PERMISSIONS.ARTICLES_MANAGE);
  const rows = await withRls(actorRlsCtx(actor), (tx) =>
    tx.report.findMany({ where: { entityType, status: "pending" }, select: { entityId: true } })
  );
  return new Set(rows.map((r) => r.entityId));
}

async function requirePendingReport(reportId: string, actor: AuthzActor) {
  requirePermission(actor, PERMISSIONS.ARTICLES_MANAGE);
  const report = await withRls(actorRlsCtx(actor), (tx) => tx.report.findUnique({ where: { id: reportId } }));
  if (!report) throw new ReportNotFoundError();
  if (report.status !== "pending") throw new InvalidReportTransitionError();
  return report;
}

/** Marks a report reviewed — the moderator looked at it and (typically) already acted on the underlying article/profile via the existing moderation actions (adminUnpublishArticle/suspendUser/...). */
export async function resolveReport(reportId: string, actor: AuthzActor, note?: string) {
  const report = await requirePendingReport(reportId, actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.report.update({
      where: { id: reportId },
      data: { status: "reviewed", reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: note?.trim() || null },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "report.resolved",
    entityType: auditEntityType(report.entityType),
    entityId: report.entityId,
    metadata: { reportId },
  });
  return updated;
}

/** Marks a report dismissed — reviewed, no action warranted. */
export async function dismissReport(reportId: string, actor: AuthzActor, note?: string) {
  const report = await requirePendingReport(reportId, actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.report.update({
      where: { id: reportId },
      data: { status: "dismissed", reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: note?.trim() || null },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "report.dismissed",
    entityType: auditEntityType(report.entityType),
    entityId: report.entityId,
    metadata: { reportId },
  });
  return updated;
}
