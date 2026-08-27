import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listOrganizations } from "@/lib/organizations";
import { AuthorizationError, PERMISSIONS, hasPermission } from "@/lib/authz";
import { createOrganizationAction } from "./actions";
import { Banner, Button, Disclosure, EmptyState, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ORG_TYPES = ["school", "church", "company", "ngo", "training_center", "government", "university", "community", "personal", "other"] as const;

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Name and slug are required.",
  not_authorized: "You do not have permission to create an organization.",
  create_failed: "Could not create the organization — the slug may already be in use.",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!hasPermission(user, PERMISSIONS.ORGANIZATIONS_MANAGE)) {
    return <Banner>You do not have permission to view organizations (requires organizations.manage).</Banner>;
  }

  const params = await searchParams;
  const status = ["pending", "active", "suspended", "archived"].includes(params.status ?? "")
    ? (params.status as "pending" | "active" | "suspended" | "archived")
    : undefined;
  const search = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let result;
  try {
    result = await listOrganizations({ status, search, page, pageSize: 20 }, user);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You do not have permission to view organizations.</Banner>;
    }
    throw err;
  }

  const { organizations, total, pageSize } = result;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(p: number) {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (search) qs.set("q", search);
    qs.set("page", String(p));
    return `/organizations?${qs.toString()}`;
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {params.error && <Banner>{ERROR_MESSAGES[params.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title="Organizations" count={total} />

        <form method="get" className={ui.filterBar}>
          <Field label="Search">
            <Input name="q" defaultValue={search ?? ""} placeholder="Organization name" />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        {organizations.length === 0 ? (
          <EmptyState title="No organizations match these filters" hint="Try clearing the search or status filter." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((o) => (
                <tr key={o.id}>
                  <td className={ui.nameCell}>
                    {o.name}
                    <span className={ui.subCell}>{o.slug}</span>
                  </td>
                  <td>{o.type}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className={ui.mono}>{formatDate(o.createdAt)}</td>
                  <td>
                    <a className={ui.linkMono} href={`/organizations/${o.id}`}>
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
            {result.page > 1 ? <a href={pageHref(result.page - 1)}>Previous</a> : <span className="disabled">Previous</span>}
            {result.page < totalPages ? <a href={pageHref(result.page + 1)}>Next</a> : <span className="disabled">Next</span>}
          </div>
        </div>

        <Disclosure label="New organization">
          <form action={createOrganizationAction} style={{ display: "contents" }}>
            <Field label="Name">
              <Input name="name" placeholder="e.g. Lagos Community School" required />
            </Field>
            <Field label="Slug">
              <Input name="slug" placeholder="e.g. lagos-community-school" required />
            </Field>
            <Field label="Type">
              <Select name="type" defaultValue="other">
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" className={ui.fieldWide}>
              <Input name="description" placeholder="Optional" />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Create organization
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>
    </div>
  );
}
