import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listUsers } from "@/lib/users";
import { AuthorizationError, PERMISSIONS, ROLE_NAMES, hasPermission, type RoleName } from "@/lib/authz";
import { createUserAction } from "./actions";
import {
  Banner,
  Button,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Select,
  SectionHeader,
  StatusBadge,
  Table,
} from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

// SUPER_ADMIN is deliberately not offered as an assignable role here — the
// real super-admin bypass is User.isSuperAdmin (set only by the seed/direct
// SQL, see prisma/seed/tasks/super-admin.ts), not this role label. Offering
// it would suggest assigning it grants that bypass, which it does not.
const ASSIGNABLE_ROLES = ROLE_NAMES.filter((r) => r !== "SUPER_ADMIN");

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Email, name, and password are all required.",
  no_roles: "Select at least one role.",
  not_authorized: "You do not have permission to create users.",
  create_failed: "Could not create the user — check the details and try again (email may already be in use).",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; status?: string; q?: string; page?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!hasPermission(user, PERMISSIONS.USERS_READ)) {
    return (
      <Banner>You do not have permission to view users (requires users.read).</Banner>
    );
  }

  const params = await searchParams;
  const role = ROLE_NAMES.includes(params.role as RoleName) ? (params.role as RoleName) : undefined;
  const status = params.status === "active" || params.status === "suspended" ? params.status : undefined;
  const search = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let result;
  try {
    result = await listUsers({ role, status, search, page, pageSize: 20 }, user);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You do not have permission to view users.</Banner>;
    }
    throw err;
  }

  const { users, total, pageSize } = result;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(p: number) {
    const qs = new URLSearchParams();
    if (role) qs.set("role", role);
    if (status) qs.set("status", status);
    if (search) qs.set("q", search);
    qs.set("page", String(p));
    return `/users?${qs.toString()}`;
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {params.error && <Banner>{ERROR_MESSAGES[params.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title="Users" count={total} />

        <form method="get" className={ui.filterBar}>
          <Field label="Search">
            <Input name="q" defaultValue={search ?? ""} placeholder="Name or email" />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue={role ?? ""}>
              <option value="">All roles</option>
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
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
          <EmptyState title="No users match these filters" hint="Try clearing the search or role filter." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Roles</th>
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
                    {u.isSuperAdmin && <span className={ui.roleTag}>SUPER_ADMIN</span>}
                    {u.roles.map((r) => (
                      <span key={r} className={ui.roleTag}>
                        {r}
                      </span>
                    ))}
                    {!u.isSuperAdmin && u.roles.length === 0 && <span className={ui.roleTag}>none</span>}
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className={ui.mono}>{formatDate(u.createdAt)}</td>
                  <td>
                    <a className={ui.linkMono} href={`/users/${u.id}`}>
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

        {hasPermission(user, PERMISSIONS.USERS_CREATE) && (
          <Disclosure label="New user">
            <form action={createUserAction} style={{ display: "contents" }}>
              <Field label="Full name">
                <Input name="name" placeholder="e.g. Ada Lovelace" required />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" placeholder="ada@example.com" required />
              </Field>
              <Field label="Temporary password" className={ui.fieldWide}>
                <Input name="password" type="password" minLength={8} required />
              </Field>
              <Field label="Roles" className={ui.fieldWide}>
                <div>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <label key={r} style={{ marginRight: 14, fontSize: 12.5 }}>
                      <input type="checkbox" name="roles" value={r} /> {r}
                    </label>
                  ))}
                </div>
              </Field>
              <div className={ui.disclosureActions}>
                <Button type="submit" variant="primary">
                  Create user
                </Button>
              </div>
            </form>
          </Disclosure>
        )}
      </section>
    </div>
  );
}
