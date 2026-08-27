import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrganizationById, hasOrgPermission, listOrganizationInvitations, listOrganizationMembers } from "@/lib/organizations";
import { AuthorizationError } from "@/lib/authz";
import {
  approveJoinRequestSelfAction,
  changeMemberRoleSelfAction,
  inviteMemberSelfAction,
  rejectJoinRequestSelfAction,
  reinstateMembershipSelfAction,
  removeMembershipSelfAction,
  revokeInvitationSelfAction,
  suspendMembershipSelfAction,
  updateOrganizationSettingsSelfAction,
} from "@/lib/onboarding-actions";
import { Banner, Button, Card, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * Session 18's org-admin-facing member management surface —
 * /organization/[id], reachable by any TEACHER or STUDENT who holds an
 * ACTIVE org_admin OrganizationMembership for this specific organization
 * (checked via src/lib/organizations.ts's hasOrgPermission — never platform
 * "organizations.manage", which stays the Session 17 admin console's own,
 * separate cross-tenant surface at /admin/organizations/[id]). Deliberately
 * omits the platform status-lifecycle controls (pending/active/suspended/
 * archived) that admin console page has — setOrganizationStatus() is
 * organizations.manage-only by design (src/lib/organizations.ts's own
 * docstring), never delegable to an org_admin.
 */
export async function OrganizationManage({
  organizationId,
  searchParams,
}: {
  organizationId: string;
  searchParams: { error?: string; inviteLinkKey?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!(await hasOrgPermission(organizationId, actor, "org_admin"))) {
    return <Banner>You do not have permission to manage this organization (requires org_admin membership).</Banner>;
  }

  const org = await getOrganizationById(organizationId, actor);
  if (!org) return <Banner>Organization not found.</Banner>;

  let members: Awaited<ReturnType<typeof listOrganizationMembers>> = [];
  let invitations: Awaited<ReturnType<typeof listOrganizationInvitations>> = [];
  try {
    [members, invitations] = await Promise.all([
      listOrganizationMembers(organizationId, actor),
      listOrganizationInvitations(organizationId, actor),
    ]);
  } catch (err) {
    if (!(err instanceof AuthorizationError)) throw err;
  }

  let inviteLink: string | null = null;
  if (searchParams.inviteLinkKey) {
    const store = await cookies();
    inviteLink = store.get(searchParams.inviteLinkKey)?.value ?? null;
  }

  const activeAdminCount = members.filter((m) => m.role === "org_admin" && m.status === "active").length;

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/organization" className={ui.linkMono}>
        ← My organizations
      </a>

      {searchParams.error && <Banner>{ERROR_MESSAGES[searchParams.error] ?? "Something went wrong."}</Banner>}
      {inviteLink && (
        <Banner variant="success">
          Invitation created. No email provider is connected yet (Session 19) — share this link directly (expires in 14 days, single
          use, only shown once):
          <div className={ui.mono} style={{ marginTop: 6, wordBreak: "break-all" }}>
            {inviteLink}
          </div>
        </Banner>
      )}
      {searchParams.inviteLinkKey && !inviteLink && (
        <Banner>The invite link already expired from view (shown once, for 60 seconds) — the invitation itself is still valid; check &quot;Pending email invitations&quot; below.</Banner>
      )}

      <section>
        <SectionHeader title={org.name} count={0} />
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={org.status} />
            <span className={ui.roleTag}>{org.type}</span>
          </div>
          <div className={ui.mono}>{org.slug}</div>

          <form
            action={updateOrganizationSettingsSelfAction}
            style={{ display: "grid", gap: "10px", gridTemplateColumns: "1fr 1fr", alignItems: "flex-end" }}
          >
            <input type="hidden" name="organizationId" value={org.id} />
            <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
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
        </Card>
      </section>

      <section>
        <SectionHeader title="Members" count={members.length} />
        {members.length === 0 ? (
          <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>No members yet.</Card>
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
                    <form action={changeMemberRoleSelfAction} style={{ display: "inline-flex", gap: "6px" }}>
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
                      <Select name="role" defaultValue={m.role} disabled={m.status !== "active"}>
                        <option value="org_admin">org_admin</option>
                        <option value="org_member">org_member</option>
                      </Select>
                      <Button type="submit" variant="outline" disabled={m.status !== "active"}>
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
                        <form action={approveJoinRequestSelfAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
                          <Button type="submit" variant="secondary">
                            Approve
                          </Button>
                        </form>
                        <form action={rejectJoinRequestSelfAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
                          <Button type="submit" variant="outline">
                            Reject
                          </Button>
                        </form>
                      </>
                    )}
                    {m.status === "active" && (
                      <>
                        <form action={suspendMembershipSelfAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
                          <Button type="submit" variant="danger" disabled={m.role === "org_admin" && activeAdminCount <= 1}>
                            Suspend
                          </Button>
                        </form>
                        <form action={removeMembershipSelfAction}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
                          <Button type="submit" variant="outline" disabled={m.role === "org_admin" && activeAdminCount <= 1}>
                            Remove
                          </Button>
                        </form>
                      </>
                    )}
                    {m.status === "suspended" && (
                      <form action={reinstateMembershipSelfAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="membershipId" value={m.membershipId} />
                        <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
                        <Button type="submit" variant="secondary">
                          Reinstate
                        </Button>
                      </form>
                    )}
                    {m.status === "invited" && <span className={ui.subCell}>Waiting for them to accept</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Card style={{ padding: "16px", marginTop: "12px" }}>
          <form action={inviteMemberSelfAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="organizationId" value={org.id} />
            <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
            <Field label="Invite by email">
              <Input name="email" type="email" placeholder="person@example.com" required />
            </Field>
            <Field label="Offered org role">
              <Select name="role" defaultValue="org_member">
                <option value="org_member">org_member</option>
                <option value="org_admin">org_admin</option>
              </Select>
            </Field>
            <Field label="Register as">
              <Select name="platformRole" defaultValue="STUDENT">
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
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
                    <form action={revokeInvitationSelfAction}>
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <input type="hidden" name="redirectTo" value={`/organization/${org.id}`} />
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
