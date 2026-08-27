import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrganizationById, listOrganizationInvitations, listOrganizationMembers } from "@/lib/organizations";
import { AuthorizationError, PERMISSIONS, hasPermission } from "@/lib/authz";
import {
  approveJoinRequestAction,
  changeMemberRoleAction,
  inviteMemberAction,
  rejectJoinRequestAction,
  reinstateMembershipAction,
  removeMembershipAction,
  revokeInvitationAction,
  setStatusAction,
  suspendMembershipAction,
  updateSettingsAction,
} from "./actions";
import { Banner, Button, Card, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!hasPermission(actor, PERMISSIONS.ORGANIZATIONS_MANAGE)) {
    return <Banner>You do not have permission to view organizations (requires organizations.manage).</Banner>;
  }

  const { id } = await params;
  const query = await searchParams;

  const org = await getOrganizationById(id, actor);
  if (!org) return <Banner>Organization not found.</Banner>;

  let members: Awaited<ReturnType<typeof listOrganizationMembers>> = [];
  let invitations: Awaited<ReturnType<typeof listOrganizationInvitations>> = [];
  try {
    [members, invitations] = await Promise.all([listOrganizationMembers(id, actor), listOrganizationInvitations(id, actor)]);
  } catch (err) {
    if (!(err instanceof AuthorizationError)) throw err;
  }

  const activeAdminCount = members.filter((m) => m.role === "org_admin" && m.status === "active").length;

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/organizations" className={ui.linkMono}>
        ← All organizations
      </a>

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title={org.name} count={0} />
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={org.status} />
            <span className={ui.roleTag}>{org.type}</span>
          </div>
          <div className={ui.mono}>{org.slug}</div>
          <div className={ui.mono}>Created {formatDateTime(org.createdAt)}</div>

          <form action={updateSettingsAction} style={{ display: "grid", gap: "10px", gridTemplateColumns: "1fr 1fr", alignItems: "flex-end" }}>
            <input type="hidden" name="organizationId" value={org.id} />
            <Field label="Name">
              <Input name="name" defaultValue={org.name} />
            </Field>
            <Field label="Type">
              <Select name="type" defaultValue={org.type}>
                {["school", "church", "company", "ngo", "training_center", "government", "university", "community", "personal", "other"].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  )
                )}
              </Select>
            </Field>
            <Field label="Contact email" className={ui.fieldWide}>
              <Input name="contactEmail" type="email" defaultValue={org.contactEmail ?? ""} />
            </Field>
            <Field label="Contact phone" className={ui.fieldWide}>
              <Input name="contactPhone" defaultValue={org.contactPhone ?? ""} />
            </Field>
            <Field label="Description" className={ui.fieldWide}>
              <Input name="description" defaultValue={org.description ?? ""} />
            </Field>
            <div>
              <Button type="submit" variant="secondary">
                Save settings
              </Button>
            </div>
          </form>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {(["pending", "active", "suspended", "archived"] as const)
              .filter((s) => s !== org.status)
              .map((s) => (
                <form key={s} action={setStatusAction}>
                  <input type="hidden" name="organizationId" value={org.id} />
                  <input type="hidden" name="status" value={s} />
                  <Button type="submit" variant={s === "suspended" || s === "archived" ? "danger" : "outline"}>
                    Set {s}
                  </Button>
                </form>
              ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Members" count={members.length} />
        {members.length === 0 ? (
          <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>
            No members, or you don&apos;t have permission to view the roster (requires org_admin or organizations.manage).
          </Card>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.membershipId}>
                  <td className={ui.nameCell}>
                    {m.name}
                    <span className={ui.subCell}>{m.email}</span>
                  </td>
                  <td>
                    <form action={changeMemberRoleAction} style={{ display: "inline-flex", gap: "6px" }}>
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <Select name="role" defaultValue={m.role}>
                        <option value="org_admin">org_admin</option>
                        <option value="org_member">org_member</option>
                      </Select>
                      <Button type="submit" variant="outline">
                        Set role
                      </Button>
                    </form>
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {m.status === "pending" && (
                      <>
                        <form action={approveJoinRequestAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <Button type="submit" variant="secondary">
                            Approve
                          </Button>
                        </form>
                        <form action={rejectJoinRequestAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <Button type="submit" variant="outline">
                            Reject
                          </Button>
                        </form>
                      </>
                    )}
                    {m.status === "active" && (
                      <>
                        <form action={suspendMembershipAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <Button type="submit" variant="danger" disabled={m.role === "org_admin" && activeAdminCount <= 1}>
                            Suspend
                          </Button>
                        </form>
                        <form action={removeMembershipAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <Button type="submit" variant="outline" disabled={m.role === "org_admin" && activeAdminCount <= 1}>
                            Remove
                          </Button>
                        </form>
                      </>
                    )}
                    {m.status === "suspended" && (
                      <form action={reinstateMembershipAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                        <Button type="submit" variant="secondary">
                          Reinstate
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Card style={{ padding: "16px", marginTop: "12px" }}>
          <form action={inviteMemberAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="organizationId" value={org.id} />
            <Field label="Invite by email">
              <Input name="email" type="email" placeholder="person@example.com" required />
            </Field>
            <Field label="Offered role">
              <Select name="role" defaultValue="org_member">
                <option value="org_member">org_member</option>
                <option value="org_admin">org_admin</option>
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              Invite
            </Button>
          </form>
        </Card>
      </section>

      {invitations.length > 0 && (
        <section>
          <SectionHeader title="Pending email invitations" count={invitations.length} />
          <Table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className={ui.mono}>{inv.email}</td>
                  <td>{inv.role}</td>
                  <td className={ui.mono}>{formatDateTime(inv.expiresAt)}</td>
                  <td>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button type="submit" variant="outline">
                        Revoke
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}
