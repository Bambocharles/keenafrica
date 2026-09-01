import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listUsers } from "@/lib/users";
import { AuthorizationError, PERMISSIONS, hasPermission } from "@/lib/authz";
import { Banner, EmptyState, Field, Input, Button, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Keen
 * Africans user search/filter — reuses src/lib/users.ts's listUsers()
 * exactly as the platform-wide /users console does, just pinned to
 * role: "KEEN_AFRICAN" (that function already supports search/status/
 * pagination — no new listing function needed). Requires users.read, same
 * gate the platform-wide console uses; suspend/reinstate on the detail
 * page additionally require users.suspend.
 */
function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function KeenAfricansUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!hasPermission(user, PERMISSIONS.USERS_READ)) {
    return <Banner>You do not have permission to view Keen Africans (requires users.read).</Banner>;
  }

  const params = await searchParams;
  const status = params.status === "active" || params.status === "suspended" ? params.status : undefined;
  const search = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let result;
  try {
    result = await listUsers({ role: "KEEN_AFRICAN", status, search, page, pageSize: 20 }, user);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You do not have permission to view Keen Africans.</Banner>;
    }
    throw err;
  }

  const { users, total, pageSize } = result;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(p: number) {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (search) qs.set("q", search);
    qs.set("page", String(p));
    return `/keen-africans/users?${qs.toString()}`;
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/keen-africans" className={ui.linkMono}>
        ← Keen Africans moderation
      </a>

      <section>
        <SectionHeader title="Keen Africans" count={total} />

        <form method="get" className={ui.filterBar}>
          <Field label="Search">
            <Input name="q" defaultValue={search ?? ""} placeholder="Name or email" />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        {users.length === 0 ? (
          <EmptyState title="No Keen Africans match these filters" hint="Try clearing the search or status filter." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={ui.nameCell}>
                    {u.name}
                    <span className={ui.subCell}>{u.email}</span>
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className={ui.mono}>{formatDate(u.createdAt)}</td>
                  <td>
                    <a className={ui.linkMono} href={`/keen-africans/users/${u.id}`}>
                      View →
                    </a>
                  </td>
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
