import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  acceptOrganizationInvitation,
  listMyOrganizations,
  searchJoinableOrganizations,
} from "@/lib/organizations";
import {
  acceptMembershipInviteSelfAction,
  createOrganizationSelfAction,
  leaveOrDeclineMembershipSelfAction,
  requestToJoinSelfAction,
} from "@/lib/onboarding-actions";
import { Banner, Button, Card, Disclosure, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ORG_TYPES = [
  "school",
  "church",
  "company",
  "ngo",
  "training_center",
  "government",
  "university",
  "community",
  "personal",
  "other",
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Name and slug are required.",
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed — the slug may already be in use, or you may already have a pending request.",
};

/**
 * Session 18 — the "are you joining an organization?" decision surface,
 * shared by BOTH:
 *   - /onboarding (mode="onboarding"): shown right after registration.
 *     Redeems a ?invite= token automatically (see the header comment
 *     below), then presents create/join/skip — "skip" is just a plain
 *     link to /dashboard, matching this session's explicit "neither:
 *     proceeds as an independent (B2C) user with no organization" path.
 *   - /organization (mode="workspace"): the durable, revisit-anytime
 *     version — same create/join UI, plus every existing membership
 *     (including 'invited' rows to accept/decline and active ones to
 *     leave) and a link into each org_admin membership's roster manager
 *     (/organization/[id]).
 *
 * One component for both so the create/join/accept/decline logic and its
 * authorization boundaries are defined exactly once (CLAUDE_BUILD_RULES.md
 * §3) rather than duplicated per portal per surface — teacher and student
 * each get a two-line page.tsx wrapper (see
 * src/app/{teacher,student}/(protected)/{onboarding,organization}/page.tsx).
 */
export async function OrganizationHome({
  mode,
  searchParams,
}: {
  mode: "onboarding" | "workspace";
  searchParams: { error?: string; q?: string; invite?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  let inviteBanner: { variant: "success" | "danger"; text: string } | null = null;
  if (searchParams.invite) {
    const outcome = await acceptOrganizationInvitation(searchParams.invite, actor);
    if (outcome === "ok") {
      // Redeemed — the person is now an active member at the offered role.
      // Nothing further to decide, so skip straight past the rest of the
      // decision UI (this session's "an invited person completes
      // registration already linked to that organization" criterion).
      redirect(mode === "onboarding" ? "/dashboard?joinedOrganization=1" : "/organization?joinedOrganization=1");
    }
    inviteBanner = {
      variant: "danger",
      text: "That invitation link is invalid or has expired. You can still create or join an organization below.",
    };
  }

  const memberships = await listMyOrganizations(actor);
  const membershipByOrgId = new Map(memberships.map((m) => [m.organizationId, m]));
  const search = searchParams.q?.trim();
  const searchResults = search ? await searchJoinableOrganizations(search, actor) : [];

  const redirectTo = mode === "onboarding" ? "/dashboard" : "/organization";
  const searchPath = mode === "onboarding" ? "/onboarding" : "/organization";
  const invitedMemberships = memberships.filter((m) => m.status === "invited");
  const activeOrPendingMemberships = memberships.filter((m) => m.status !== "invited" && m.status !== "removed");

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {mode === "onboarding" && (
        <section>
          <SectionHeader title="Welcome to Keen Africa" count={0} />
          <p style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: -8 }}>
            Are you joining an organization — a school, company, or training center — or learning/teaching independently?
            You can always change this later from &quot;Organization&quot; in the sidebar.
          </p>
        </section>
      )}

      {inviteBanner && <Banner variant={inviteBanner.variant}>{inviteBanner.text}</Banner>}
      {searchParams.error && <Banner>{ERROR_MESSAGES[searchParams.error] ?? "Something went wrong."}</Banner>}

      {invitedMemberships.length > 0 && (
        <section>
          <SectionHeader title="Pending invitations" count={invitedMemberships.length} />
          <Table>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Offered role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitedMemberships.map((m) => (
                <tr key={m.id}>
                  <td className={ui.nameCell}>{m.organization.name}</td>
                  <td>{m.role}</td>
                  <td style={{ display: "flex", gap: "6px" }}>
                    <form action={acceptMembershipInviteSelfAction}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <input type="hidden" name="redirectTo" value={redirectTo} />
                      <Button type="submit" variant="primary">
                        Accept
                      </Button>
                    </form>
                    <form action={leaveOrDeclineMembershipSelfAction}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <input type="hidden" name="redirectTo" value={searchPath} />
                      <Button type="submit" variant="outline">
                        Decline
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {mode === "workspace" && (
        <section>
          <SectionHeader title="My organizations" count={activeOrPendingMemberships.length} />
          {activeOrPendingMemberships.length === 0 ? (
            <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>
              You aren&apos;t a member of any organization yet — you&apos;re using Keen Africa independently.
            </Card>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Your role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeOrPendingMemberships.map((m) => (
                  <tr key={m.id}>
                    <td className={ui.nameCell}>{m.organization.name}</td>
                    <td>{m.role}</td>
                    <td>
                      <StatusBadge status={m.status} />
                    </td>
                    <td style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {m.role === "org_admin" && m.status === "active" && (
                        <a className={ui.linkMono} href={`/organization/${m.organizationId}`}>
                          Manage →
                        </a>
                      )}
                      {m.status === "active" && (
                        <form action={leaveOrDeclineMembershipSelfAction}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <input type="hidden" name="redirectTo" value="/organization" />
                          <Button type="submit" variant="ghost">
                            Leave
                          </Button>
                        </form>
                      )}
                      {m.status === "pending" && <span className={ui.subCell}>Waiting for an admin to approve</span>}
                      {m.status === "suspended" && <span className={ui.subCell}>Suspended by an organization admin</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}

      <section>
        <SectionHeader title="Join an existing organization" count={0} />
        <form method="get" className={ui.filterBar}>
          <Field label="Search by name">
            <Input name="q" defaultValue={search ?? ""} placeholder="e.g. Baobab Learning Hub" />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {search && searchResults.length === 0 && (
          <Card style={{ padding: "16px", color: "var(--ink-faint)", fontSize: 13 }}>No organizations match &quot;{search}&quot;.</Card>
        )}

        {searchResults.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {searchResults.map((o) => {
                const existing = membershipByOrgId.get(o.id);
                return (
                  <tr key={o.id}>
                    <td className={ui.nameCell}>
                      {o.name}
                      <span className={ui.subCell}>{o.slug}</span>
                    </td>
                    <td>{o.type}</td>
                    <td>
                      {existing ? (
                        <StatusBadge status={existing.status} />
                      ) : (
                        <form action={requestToJoinSelfAction}>
                          <input type="hidden" name="organizationId" value={o.id} />
                          <input type="hidden" name="redirectTo" value={`${searchPath}?q=${encodeURIComponent(search ?? "")}`} />
                          <Button type="submit" variant="primary">
                            Request to join
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <Disclosure label="Create a new organization">
          <form action={createOrganizationSelfAction} style={{ display: "contents" }}>
            <input type="hidden" name="redirectTo" value={redirectTo} />
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
                Create organization — you&apos;ll be its admin
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      {mode === "onboarding" && (
        <p style={{ textAlign: "center" }}>
          <a className={ui.linkMono} href="/dashboard">
            Skip for now — continue independently →
          </a>
        </p>
      )}
    </div>
  );
}
