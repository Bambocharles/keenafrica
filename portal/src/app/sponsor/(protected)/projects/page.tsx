import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/sponsor";
import { EmptyState, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function SponsorProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const projects = await listMyProjects(actor);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Projects" count={projects.length} />

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" hint="Your administrator hasn't added you to a project's sponsor team yet." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Sponsor</th>
              <th>Status</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className={ui.nameCell}>
                  <a href={`/projects/${p.id}`}>{p.name}</a>
                </td>
                <td>{p.sponsor.name}</td>
                <td>
                  <StatusBadge status={p.status as "active" | "draft" | "paused"} />
                </td>
                <td className={ui.mono}>{formatDate(p.startDate)}</td>
                <td className={ui.mono}>{formatDate(p.endDate)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
