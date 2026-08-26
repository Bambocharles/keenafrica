import { withRls } from "@/lib/rls";

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
