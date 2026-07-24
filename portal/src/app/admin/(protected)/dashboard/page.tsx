import { auth } from "@/lib/auth";
import { withRls } from "@/lib/rls";
import { createSponsor, createProject } from "../sponsors/actions";

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;

  const { sponsors, projects } = await withRls(
    { userId: user.id, isSuperAdmin: true },
    async (tx) => ({
      sponsors: await tx.sponsor.findMany({ orderBy: { createdAt: "desc" } }),
      projects: await tx.project.findMany({
        orderBy: { createdAt: "desc" },
        include: { sponsor: true },
      }),
    })
  );

  const rootDomain = process.env.ROOT_DOMAIN ?? "dev.keenafrica.com";

  return (
    <div style={{ display: "grid", gap: "3rem", maxWidth: 720 }}>
      <section>
        <h2>Sponsors</h2>
        <ul>
          {sponsors.map((s) => (
            <li key={s.id}>{s.name}</li>
          ))}
          {sponsors.length === 0 && <li>No sponsors yet.</li>}
        </ul>
        <form action={createSponsor} style={{ display: "flex", gap: "0.5rem" }}>
          <input name="name" placeholder="Sponsor name" required />
          <button type="submit">Add sponsor</button>
        </form>
      </section>

      <section>
        <h2>Projects</h2>
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong> ({p.sponsor.name}) —{" "}
              <a href={`https://${p.slug}.${rootDomain}`}>
                {p.slug}.{rootDomain}
              </a>{" "}
              [{p.status}]
            </li>
          ))}
          {projects.length === 0 && <li>No projects yet.</li>}
        </ul>
        <form
          action={createProject}
          style={{ display: "grid", gap: "0.5rem", maxWidth: 360 }}
        >
          <input name="name" placeholder="Project name" required />
          <input
            name="slug"
            placeholder="subdomain-slug (e.g. anthropicskillup)"
            pattern="[a-z0-9-]{3,40}"
            required
          />
          <select name="sponsorId" required defaultValue="">
            <option value="" disabled>
              Select sponsor
            </option>
            {sponsors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit">Create project</button>
        </form>
      </section>
    </div>
  );
}
