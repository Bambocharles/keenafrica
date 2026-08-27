import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getProjectForSponsor,
  getProjectBeneficiaryCount,
  getProjectImpactSummary,
  listMilestonesForProject,
  listProjectBeneficiaries,
  listProjectDocuments,
  listProjectTeam,
} from "@/lib/sponsor";
import { AuthorizationError, hasPermission, PERMISSIONS } from "@/lib/authz";
import { inviteTeamMemberAction, removeTeamMemberAction } from "./actions";
import { Banner, Button, Card, Disclosure, EmptyState, Field, Input, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  "Email is required": "Email is required.",
  "No platform account exists for that email yet — an admin must create it first":
    "No platform account exists for that email yet — ask an administrator to create one first.",
  action_failed: "That action could not be completed.",
};

function formatDate(date: Date | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function SponsorProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; success?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const { id: projectId } = await params;
  const query = await searchParams;

  let project;
  try {
    project = await getProjectForSponsor(projectId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You are not part of this project&apos;s sponsor team.</Banner>;
    }
    throw err;
  }
  if (!project) return <Banner>Project not found.</Banner>;

  const [milestones, impactSummary, beneficiaryCount, beneficiaries, documents, team] = await Promise.all([
    listMilestonesForProject(projectId, actor),
    getProjectImpactSummary(projectId, actor),
    getProjectBeneficiaryCount(projectId, actor),
    listProjectBeneficiaries(projectId, actor),
    listProjectDocuments(projectId, actor),
    listProjectTeam(projectId, actor),
  ]);

  const canManageTeam = hasPermission(actor, PERMISSIONS.SPONSOR_USERS_MANAGE) || actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.SPONSOR_MANAGE);

  return (
    <div style={{ display: "grid", gap: "28px" }}>
      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? query.error}</Banner>}
      {query.notice === "member_added_needs_role" && (
        <Banner variant="success">
          Team member added to this project. They still need an administrator to grant them the Sponsor role before
          they can sign in.
        </Banner>
      )}
      {query.success === "1" && !query.error && !query.notice && <Banner variant="success">Done.</Banner>}

      <section style={{ display: "grid", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{project.name}</h2>
            <div className={ui.mono} style={{ marginTop: 4 }}>
              In partnership with {project.sponsor.name}
            </div>
          </div>
          <StatusBadge status={project.status as "active" | "draft" | "paused"} />
        </div>
        {project.description && <p style={{ margin: 0, color: "var(--ink-soft)" }}>{project.description}</p>}
        <div style={{ display: "flex", gap: "18px", fontSize: 12.5, color: "var(--ink-soft)" }}>
          <span>Start: {formatDate(project.startDate)}</span>
          <span>End: {formatDate(project.endDate)}</span>
        </div>
      </section>

      <section>
        <SectionHeader title="Milestones" count={milestones.length} />
        {milestones.length === 0 ? (
          <EmptyState title="No milestones yet" hint="Your administrator will add project milestones here as they're agreed." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Target date</th>
                <th>Achieved</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id}>
                  <td className={ui.nameCell}>
                    {m.title}
                    {m.description && <div className={ui.mono}>{m.description}</div>}
                  </td>
                  <td>
                    <StatusBadge status={m.status as "planned" | "in_progress" | "achieved" | "missed"} />
                  </td>
                  <td className={ui.mono}>{formatDate(m.targetDate)}</td>
                  <td className={ui.mono}>{formatDate(m.achievedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeader title="Impact metrics" count={impactSummary.length} />
        {impactSummary.length === 0 ? (
          <EmptyState title="No metrics recorded yet" hint="Agreed impact metrics will appear here once your administrator records them." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Latest value</th>
                <th>As of</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {impactSummary.map((m) => (
                <tr key={m.label}>
                  <td className={ui.nameCell}>{m.label}</td>
                  <td className={ui.mono}>
                    {m.latestValue}
                    {m.unit ? ` ${m.unit}` : ""}
                  </td>
                  <td className={ui.mono}>{formatDate(m.recordedAt)}</td>
                  <td className={ui.mono}>{m.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeader title="Beneficiaries" count={beneficiaryCount} />
        {beneficiaries.length === 0 ? (
          <EmptyState title="No beneficiaries recorded yet" />
        ) : (
          <Disclosure label={`View ${beneficiaries.length} beneficiary name(s)`}>
            <p className={ui.mono} style={{ marginBottom: 8 }}>
              First name and last initial only — full contact and academic details are never shown here.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              {beneficiaries.map((b) => (
                <li key={b.id}>{b.displayName}</li>
              ))}
            </ul>
          </Disclosure>
        )}
      </section>

      <section>
        <SectionHeader title="Documents" count={documents.length} />
        {documents.length === 0 ? (
          <EmptyState title="No documents yet" hint="Reports and other sponsor-visible files will appear here." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>File</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className={ui.nameCell}>{d.title}</td>
                  <td className={ui.mono}>{d.asset.originalFilename}</td>
                  <td className={ui.mono}>{Math.round(d.asset.sizeBytes / 1024)} KB</td>
                  <td>
                    <a href={`/assets/${d.assetId}/download`}>Download</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeader title="Sponsor team" count={team.length} />
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              {canManageTeam && <th></th>}
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.userId}>
                <td className={ui.nameCell}>{m.name}</td>
                <td className={ui.mono}>{m.email}</td>
                {canManageTeam && (
                  <td>
                    <form action={removeTeamMemberAction}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button type="submit" variant="ghost">
                        Remove
                      </Button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>

        {canManageTeam && (
          <Card style={{ padding: "16px", marginTop: 12, maxWidth: 420 }}>
            <form action={inviteTeamMemberAction} style={{ display: "grid", gap: "10px" }}>
              <input type="hidden" name="projectId" value={projectId} />
              <Field label="Add a sponsor-team colleague by email">
                <Input name="email" type="email" required placeholder="colleague@example.com" />
              </Field>
              <div>
                <Button type="submit" variant="secondary">
                  Add to team
                </Button>
              </div>
              <p className={ui.mono} style={{ margin: 0 }}>
                They must already have a Keen Africa account — an administrator creates new accounts.
              </p>
            </form>
          </Card>
        )}
      </section>
    </div>
  );
}
