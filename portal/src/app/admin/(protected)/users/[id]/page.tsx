import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/users";
import { listSessions } from "@/lib/sessions";
import { AuthorizationError, PERMISSIONS, ROLE_NAMES, canActOnOwnResource, hasPermission } from "@/lib/authz";
import {
  assignRoleAction,
  reinstateUserAction,
  removeRoleAction,
  revokeAllSessionsAction,
  revokeSessionAction,
  suspendUserAction,
  triggerPasswordResetAction,
  updateNameAction,
} from "./actions";
import { Banner, Button, Card, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ASSIGNABLE_ROLES = ROLE_NAMES.filter((r) => r !== "SUPER_ADMIN");

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed.",
  invalid_role: "Unknown role.",
  missing_fields: "Name is required.",
  reset_unavailable: "Could not generate a reset link — the account may be suspended.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; resetLinkGenerated?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const { id } = await params;
  const query = await searchParams;

  if (!hasPermission(actor, PERMISSIONS.USERS_READ)) {
    return <Banner>You do not have permission to view users (requires users.read).</Banner>;
  }

  const target = await getUserById(id, actor);
  if (!target) {
    return <Banner>User not found.</Banner>;
  }

  let sessions: Awaited<ReturnType<typeof listSessions>> = [];
  try {
    sessions = await listSessions(id, actor);
  } catch (err) {
    if (!(err instanceof AuthorizationError)) throw err;
    // Lacks sessions.read/sessions.revoke and isn't viewing their own
    // account — leave the sessions section empty rather than erroring the
    // whole page; the rest of the profile is still useful.
  }

  const canSuspend = hasPermission(actor, PERMISSIONS.USERS_SUSPEND);
  const canManageRoles = hasPermission(actor, PERMISSIONS.ROLES_MANAGE);
  const canEditProfile = canActOnOwnResource(actor, target.id, PERMISSIONS.USERS_UPDATE);
  const canResetPassword = canActOnOwnResource(actor, target.id, PERMISSIONS.USERS_UPDATE);
  const canRevokeSessions = canActOnOwnResource(actor, target.id, PERMISSIONS.SESSIONS_REVOKE);

  let resetLink: string | null = null;
  if (query.resetLinkGenerated === "1") {
    const store = await cookies();
    resetLink = store.get(`reset_link_${id}`)?.value ?? null;
  }

  const unassignedRoles = ASSIGNABLE_ROLES.filter((r) => !target.roles.includes(r));

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/users" className={ui.linkMono}>
        ← All users
      </a>

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}
      {resetLink && (
        <Banner variant="success">
          Reset link generated (expires in 1 hour, single use). No email provider is configured yet — copy this
          link and share it with the user directly:
          <div className={ui.mono} style={{ marginTop: 6, wordBreak: "break-all" }}>
            {resetLink}
          </div>
        </Banner>
      )}
      {query.resetLinkGenerated === "1" && !resetLink && (
        <Banner>
          The reset link was generated but has already expired from view (it's only shown once, for 60
          seconds). Trigger a new one below.
        </Banner>
      )}

      <section>
        <SectionHeader title={target.name} count={0} />
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={target.status} />
            {target.isSuperAdmin && <span className={ui.roleTag}>SUPER_ADMIN (isSuperAdmin)</span>}
            {target.roles.map((r) => (
              <span key={r} className={ui.roleTag}>
                {r}
              </span>
            ))}
          </div>
          <div className={ui.mono}>{target.email}</div>
          <div className={ui.mono}>Joined {formatDateTime(target.createdAt)}</div>
          {target.suspendedAt && (
            <div className={ui.mono}>Suspended {formatDateTime(target.suspendedAt)}</div>
          )}

          {canEditProfile && (
            <form action={updateNameAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <input type="hidden" name="userId" value={target.id} />
              <Field label="Name">
                <Input name="name" defaultValue={target.name} required />
              </Field>
              <Button type="submit" variant="secondary">
                Save name
              </Button>
            </form>
          )}

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {canSuspend && target.status === "active" && (
              <form action={suspendUserAction}>
                <input type="hidden" name="userId" value={target.id} />
                <Button type="submit" variant="danger">
                  Suspend account
                </Button>
              </form>
            )}
            {canSuspend && target.status === "suspended" && (
              <form action={reinstateUserAction}>
                <input type="hidden" name="userId" value={target.id} />
                <Button type="submit" variant="secondary">
                  Reinstate account
                </Button>
              </form>
            )}
            {canResetPassword && (
              <form action={triggerPasswordResetAction}>
                <input type="hidden" name="userId" value={target.id} />
                <Button type="submit" variant="outline">
                  Generate password reset link
                </Button>
              </form>
            )}
          </div>
        </Card>
      </section>

      {canManageRoles && (
        <section>
          <SectionHeader title="Roles" count={target.roles.length} />
          <Card style={{ padding: "16px", display: "grid", gap: "12px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {target.roles.map((r) => (
                <form key={r} action={removeRoleAction} style={{ display: "inline-flex" }}>
                  <input type="hidden" name="userId" value={target.id} />
                  <input type="hidden" name="role" value={r} />
                  <Button type="submit" variant="outline">
                    Remove {r}
                  </Button>
                </form>
              ))}
            </div>
            {unassignedRoles.length > 0 && (
              <form action={assignRoleAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                <input type="hidden" name="userId" value={target.id} />
                <Field label="Assign role">
                  <Select name="role" defaultValue="">
                    <option value="" disabled>
                      Select role
                    </option>
                    {unassignedRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="secondary">
                  Assign
                </Button>
              </form>
            )}
          </Card>
        </section>
      )}

      <section>
        <SectionHeader
          title="Sessions"
          count={sessions.length}
          action={
            canRevokeSessions &&
            sessions.some((s) => !s.revokedAt) && (
              <form action={revokeAllSessionsAction}>
                <input type="hidden" name="userId" value={target.id} />
                <Button type="submit" variant="danger">
                  Revoke all sessions
                </Button>
              </form>
            )
          }
        />
        {sessions.length === 0 ? (
          <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>
            No session history, or you don&apos;t have permission to view it.
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Expires</th>
                <th>IP</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className={ui.mono}>{formatDateTime(s.createdAt)}</td>
                  <td className={ui.mono}>{formatDateTime(s.expiresAt)}</td>
                  <td className={ui.mono}>{s.ipAddress ?? "—"}</td>
                  <td>{s.revokedAt ? <StatusBadge status="suspended" /> : <StatusBadge status="active" />}</td>
                  <td>
                    {!s.revokedAt && canRevokeSessions && (
                      <form action={revokeSessionAction}>
                        <input type="hidden" name="userId" value={target.id} />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <Button type="submit" variant="outline">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
