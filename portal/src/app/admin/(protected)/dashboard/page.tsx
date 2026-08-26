import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withRls } from "@/lib/rls";
import { getSystemStatus } from "@/lib/admin-stats";
import { createSponsor, createProject } from "../sponsors/actions";
import {
  Button,
  Card,
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
  // Layout and page segments can render concurrently in the App Router, so
  // this page's own auth() call isn't guaranteed to run after the parent
  // ProtectedAdminLayout's guard has already redirected — a session that
  // goes invalid mid-request (revoked/suspended) can reach here with no
  // session at all. Session 02 (Identity & Security) made this a routine
  // occurrence rather than a 30-day-JWT-expiry edge case, so the
  // pre-existing `session!.user` non-null assertion needed this guard.
  if (!session?.user) {
    redirect("/login");
  }
  const user = session.user;

  // Was hardcoded `isSuperAdmin: true` regardless of the actual caller —
  // silently gave every admin-console visitor a full RLS bypass on this
  // query the moment the layout guard above stopped being isSuperAdmin-only
  // (see layout.tsx). Sponsor/project data has no permission model of its
  // own yet (Sponsor Core is Session 11's scope) — the real access boundary
  // for non-super-admins is `projects_select`'s `status = 'active'` RLS
  // policy, not an app-layer bypass.
  const { sponsors, projects } = await withRls(
    { userId: user.id, isSuperAdmin: user.isSuperAdmin, permissions: [...user.permissions] },
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

  const status = await getSystemStatus(user);

  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";

  return (
    <div style={{ display: "grid", gap: "40px" }}>
      <section id="status">
        <SectionHeader title="System status" count={status.usersActive + status.usersSuspended} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "12px",
          }}
        >
          <Card style={{ padding: "16px" }}>
            <div className={ui.sectionCount} style={{ fontSize: 11 }}>Users</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{status.usersActive}</div>
            <div className={ui.mono} style={{ marginTop: 4 }}>
              {status.usersSuspended} suspended
            </div>
          </Card>
          <Card style={{ padding: "16px" }}>
            <div className={ui.sectionCount} style={{ fontSize: 11 }}>Active sessions</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{status.activeSessions}</div>
          </Card>
          <Card style={{ padding: "16px" }}>
            <div className={ui.sectionCount} style={{ fontSize: 11 }}>Feature flags on</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {status.featureFlagsEnabled}/{status.featureFlagsTotal}
            </div>
          </Card>
          <Card style={{ padding: "16px" }}>
            <div className={ui.sectionCount} style={{ fontSize: 11 }}>Sponsors / Projects</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {status.sponsors}/{status.projects}
            </div>
          </Card>
        </div>
      </section>

      <section id="education">
        <SectionHeader title="Education management" count={0} />
        <EmptyState
          title="Owned by Session 04 (Education Core)"
          hint="Courses, cohorts, modules, lessons, and assessments will surface here once Education Core exists. This is a placeholder entry point, not a built feature."
        />
      </section>

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

        {user.isSuperAdmin && (
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
        )}
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

        {user.isSuperAdmin && (
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
        )}
      </section>
    </div>
  );
}
