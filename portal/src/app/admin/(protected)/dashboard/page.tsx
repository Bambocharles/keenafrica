import { auth } from "@/lib/auth";
import { withRls } from "@/lib/rls";
import { createSponsor, createProject } from "../sponsors/actions";
import {
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

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;

  const { sponsors, projects } = await withRls(
    { userId: user.id, isSuperAdmin: true },
    async (tx) => ({
      sponsors: await tx.sponsor.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { projects: true } } },
      }),
      projects: await tx.project.findMany({
        orderBy: { createdAt: "desc" },
        include: { sponsor: true },
      }),
    })
  );

  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";

  return (
    <div style={{ display: "grid", gap: "40px" }}>
      <section id="sponsors">
        <SectionHeader title="Sponsors" count={sponsors.length} />

        {sponsors.length === 0 ? (
          <EmptyState
            title="No sponsors yet"
            hint="Add a sponsor before creating a project for them."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Projects</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {sponsors.map((s) => (
                <tr key={s.id}>
                  <td className={ui.nameCell}>{s.name}</td>
                  <td>{s._count.projects}</td>
                  <td className={ui.mono}>{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Disclosure label="New sponsor">
          <form action={createSponsor} style={{ display: "contents" }}>
            <Field label="Sponsor name" className={ui.fieldWide}>
              <Input name="name" placeholder="e.g. Febambo Youth Elevate" required />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Add sponsor
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section id="projects">
        <SectionHeader title="Projects" count={projects.length} />

        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            hint="Create a project to generate its subdomain."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Sponsor</th>
                <th>Domain</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className={ui.nameCell}>{p.name}</td>
                  <td>{p.sponsor.name}</td>
                  <td className={ui.mono}>
                    <a
                      className={ui.linkMono}
                      href={`https://${p.slug}.${rootDomain}`}
                    >
                      {p.slug}.{rootDomain}
                    </a>
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className={ui.mono}>{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <Disclosure label="New project">
          <form action={createProject} style={{ display: "contents" }}>
            <Field label="Project name">
              <Input name="name" placeholder="e.g. Anthropic Skill Up" required />
            </Field>
            <Field label="Subdomain">
              <Input
                name="slug"
                placeholder="anthropicskillup"
                pattern="[a-z0-9-]{3,40}"
                required
              />
            </Field>
            <Field label="Sponsor" className={ui.fieldWide}>
              <Select name="sponsorId" required defaultValue="">
                <option value="" disabled>
                  Select sponsor
                </option>
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Create project
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>
    </div>
  );
}
