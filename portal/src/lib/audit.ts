import { withRls } from "@/lib/rls";
import { PERMISSIONS, requirePermission, type AuthzActor } from "@/lib/authz";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Append-only security/audit log — PLATFORM_DATA_MODEL.md's AuditEvent.
 * The audit_events table has no UPDATE/DELETE RLS policy at all (see the
 * identity_security_foundation migration), so once written a record cannot
 * be altered or removed through the application, by any role.
 *
 * actorId is nullable — some security events have no authenticated actor
 * (e.g. a failed login attempt against an unknown email).
 */
export interface AuditEventInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  // A plain tx.auditEvent.create() would INSERT ... RETURNING, and Postgres
  // RLS additionally enforces the SELECT policy on any row returned by an
  // INSERT/UPDATE/DELETE — which audit_events_select intentionally denies
  // to most actors (super_admin/audit.read only). That silently breaks
  // every write from anyone else, including the common case of an
  // unauthenticated actor logging a failed login. $executeRaw issues a
  // plain INSERT with no RETURNING, so only the (unconditional) INSERT
  // policy applies. Caught by src/lib/rls.integration.test.ts, which runs
  // against a real non-superuser role — the default local dev DATABASE_URL
  // connects as the Postgres superuser, which bypasses RLS entirely and
  // would never have surfaced this.
  const metadataJson = input.metadata === undefined ? null : JSON.stringify(input.metadata);

  await withRls({ userId: input.actorId ?? undefined }, (tx) =>
    tx.$executeRaw`
      INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata, ip_address)
      VALUES (
        ${input.actorId ?? null}::uuid,
        ${input.action},
        ${input.entityType},
        ${input.entityId ?? null},
        ${metadataJson}::jsonb,
        ${input.ipAddress ?? null}
      )
    `
  );
}

export interface AuditEventSummary {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

export interface ListAuditEventsFilter {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  page?: number;
  pageSize?: number;
}

export interface ListAuditEventsResult {
  events: AuditEventSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Admin console's security/audit view (Session 03). Requires audit.read —
 * the audit_events table has no ownership concept (it records actions
 * *about* the platform, not a per-user resource), so there is no
 * self-service read path here, unlike listSessions/updateUserProfile.
 */
export async function listAuditEvents(
  filter: ListAuditEventsFilter,
  actor: AuthzActor
): Promise<ListAuditEventsResult> {
  requirePermission(actor, PERMISSIONS.AUDIT_READ);

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE));

  const where = {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.actorId ? { actorId: filter.actorId } : {}),
  };

  const rlsCtx = { userId: actor.id, isSuperAdmin: actor.isSuperAdmin, permissions: [...actor.permissions] };

  const [rows, total] = await withRls(rlsCtx, (tx) =>
    Promise.all([
      tx.auditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { email: true } } },
      }),
      tx.auditEvent.count({ where }),
    ])
  );

  return {
    events: rows.map((e) => ({
      id: e.id,
      actorId: e.actorId,
      actorEmail: e.actor?.email ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
    })),
    total,
    page,
    pageSize,
  };
}
