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
import {
  addBeneficiaryAction,
  addTeamMemberAction,
  createMilestoneAction,
  recordMetricAction,
  removeDocumentAction,
  removeTeamMemberAction,
  updateMilestoneStatusAction,
  updateProjectAction,
  uploadDocumentAction,
} from "../actions";
import { Banner, Button, Card, Disclosure, EmptyState, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "That field is required.",
  action_failed: "That action could not be completed.",
};

function formatDate(date: Date | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function AdminProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.SPONSOR_MANAGE)) {
    return <Banner>You do not have permission to manage sponsor projects.</Banner>;
  }

  const { id: projectId } = await params;
  const query = await searchParams;

  let project;
  try {
    project = await getProjectForSponsor(projectId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>Not authorized.</Banner>;
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

  return (
    <div style={{ display: "grid", gap: "28px" }}>
      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? query.error}</Banner>}
      {query.success === "1" && !query.error && <Banner variant="success">Done.</Banner>}

      <section style={{ display: "grid", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{project.name}</h2>
            <div className={ui.mono} style={{ marginTop: 4 }}>
              {project.sponsor.name} · {project.slug}
            </div>
          </div>
          <StatusBadge status={project.status as "active" | "draft" | "paused"} />
        </div>

        <Disclosure label="Edit project details">
          <form action={updateProjectAction} style={{ display: "contents" }}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="Name">
              <Input name="name" defaultValue={project.name} required />
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue={project.status}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </Select>
            </Field>
            <Field label="Description" className={ui.fieldWide}>
              <Input name="description" defaultValue={project.description ?? ""} />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section>
        <SectionHeader title="Milestones" count={milestones.length} />
        {milestones.length === 0 ? (
          <EmptyState title="No milestones yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Target date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.id}>
                  <td className={ui.nameCell}>{m.title}</td>
                  <td>
                    <StatusBadge status={m.status as "planned" | "in_progress" | "achieved" | "missed"} />
                  </td>
                  <td className={ui.mono}>{formatDate(m.targetDate)}</td>
                  <td>
                    <form action={updateMilestoneStatusAction} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="milestoneId" value={m.id} />
                      <Select name="status" defaultValue={m.status}>
                        <option value="planned">Planned</option>
                        <option value="in_progress">In progress</option>
                        <option value="achieved">Achieved</option>
                        <option value="missed">Missed</option>
                      </Select>
                      <Button type="submit" variant="secondary">
                        Update
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Disclosure label="New milestone">
          <form action={createMilestoneAction} style={{ display: "contents" }}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="Title">
              <Input name="title" required />
            </Field>
            <Field label="Target date">
              <Input name="targetDate" type="date" />
            </Field>
            <Field label="Description" className={ui.fieldWide}>
              <Input name="description" />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Add milestone
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section>
        <SectionHeader title="Impact metrics" count={impactSummary.length} />
        {impactSummary.length === 0 ? (
          <EmptyState title="No metrics recorded yet" />
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

        <Disclosure label="Record a metric sample">
          <form action={recordMetricAction} style={{ display: "contents" }}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="Label">
              <Input name="label" placeholder="e.g. Beneficiaries reached" required />
            </Field>
            <Field label="Value">
              <Input name="value" type="number" step="any" required />
            </Field>
            <Field label="Unit">
              <Input name="unit" placeholder="e.g. students" />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Record
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section>
        <SectionHeader title="Beneficiaries" count={beneficiaryCount} />
        {beneficiaries.length === 0 ? (
          <EmptyState title="No beneficiaries recorded yet" />
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            {beneficiaries.map((b) => (
              <li key={b.id}>{b.displayName}</li>
            ))}
          </ul>
        )}

        <Disclosure label="Add a beneficiary">
          <form action={addBeneficiaryAction} style={{ display: "contents" }}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="Beneficiary's account email" className={ui.fieldWide}>
              <Input name="email" type="email" required />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Add
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section>
        <SectionHeader title="Documents" count={documents.length} />
        {documents.length === 0 ? (
          <EmptyState title="No documents yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>File</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className={ui.nameCell}>{d.title}</td>
                  <td className={ui.mono}>{d.asset.originalFilename}</td>
                  <td>
                    <form action={removeDocumentAction}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="documentId" value={d.id} />
                      <Button type="submit" variant="ghost">
                        Remove
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Disclosure label="Upload a document">
          <form action={uploadDocumentAction} encType="multipart/form-data" style={{ display: "contents" }}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="Title">
              <Input name="title" required />
            </Field>
            <Field label="File" className={ui.fieldWide}>
              <input name="file" type="file" required />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Upload
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section>
        <SectionHeader title="Sponsor team" count={team.length} />
        {team.length === 0 ? (
          <EmptyState title="No sponsor-team members yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.userId}>
                  <td className={ui.nameCell}>{m.name}</td>
                  <td className={ui.mono}>{m.email}</td>
                  <td>
                    <form action={removeTeamMemberAction}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button type="submit" variant="ghost">
                        Remove
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Disclosure label="Add a sponsor-team member">
          <form action={addTeamMemberAction} style={{ display: "contents" }}>
            <input type="hidden" name="projectId" value={projectId} />
            <Field label="Account email" className={ui.fieldWide}>
              <Input name="email" type="email" required />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Add to team
              </Button>
            </div>
          </form>
          <p className={ui.mono} style={{ marginTop: 8 }}>
            Also grants the SPONSOR_USER role automatically if the account doesn&apos;t already hold a sponsor role.
          </p>
        </Disclosure>
      </section>
    </div>
  );
}
