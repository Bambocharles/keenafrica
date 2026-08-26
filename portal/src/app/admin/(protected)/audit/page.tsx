import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listAuditEvents } from "@/lib/audit";
import { AuthorizationError, PERMISSIONS, hasPermission } from "@/lib/authz";
import { Banner, EmptyState, Field, Input, Button, SectionHeader, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!hasPermission(user, PERMISSIONS.AUDIT_READ)) {
    return <Banner>You do not have permission to view the audit log (requires audit.read).</Banner>;
  }

  const params = await searchParams;
  const action = params.action?.trim() || undefined;
  const entityType = params.entityType?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let result;
  try {
    result = await listAuditEvents({ action, entityType, page, pageSize: 50 }, user);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You do not have permission to view the audit log.</Banner>;
    }
    throw err;
  }

  const { events, total, pageSize } = result;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(p: number) {
    const qs = new URLSearchParams();
    if (action) qs.set("action", action);
    if (entityType) qs.set("entityType", entityType);
    qs.set("page", String(p));
    return `/audit?${qs.toString()}`;
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <section>
        <SectionHeader title="Audit log" count={total} />

        <form method="get" className={ui.filterBar}>
          <Field label="Action">
            <Input name="action" defaultValue={action ?? ""} placeholder="e.g. user.suspended" />
          </Field>
          <Field label="Entity type">
            <Input name="entityType" defaultValue={entityType ?? ""} placeholder="e.g. User" />
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        {events.length === 0 ? (
          <EmptyState title="No matching audit events" hint="Try clearing the filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className={ui.mono}>{formatDateTime(e.createdAt)}</td>
                  <td className={ui.mono}>{e.actorEmail ?? (e.actorId ? e.actorId.slice(0, 8) : "system")}</td>
                  <td className={ui.nameCell}>{e.action}</td>
                  <td className={ui.mono}>
                    {e.entityType}
                    {e.entityId ? `#${e.entityId.slice(0, 8)}` : ""}
                  </td>
                  <td className={ui.mono}>{e.metadata ? JSON.stringify(e.metadata) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <div className={ui.pagination}>
          <span>
            Page {result.page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            {result.page > 1 ? (
              <a href={pageHref(result.page - 1)}>Previous</a>
            ) : (
              <span className="disabled">Previous</span>
            )}
            {result.page < totalPages ? (
              <a href={pageHref(result.page + 1)}>Next</a>
            ) : (
              <span className="disabled">Next</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
