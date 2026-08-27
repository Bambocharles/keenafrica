import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDashboardSummary } from "@/lib/sponsor";
import { Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

export default async function SponsorDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const projects = await getDashboardSummary(actor);

  const totals = projects.reduce(
    (acc, p) => ({
      beneficiaries: acc.beneficiaries + p.beneficiaryCount,
      milestonesAchieved: acc.milestonesAchieved + p.milestonesAchieved,
      milestonesTotal: acc.milestonesTotal + p.milestonesTotal,
    }),
    { beneficiaries: 0, milestonesAchieved: 0, milestonesTotal: 0 }
  );

  return (
    <div style={{ display: "grid", gap: "32px" }}>
      <section>
        <SectionHeader title="Your sponsored projects" count={projects.length} />

        {projects.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            <Card style={{ padding: "16px" }}>
              <div className={ui.sectionCount} style={{ fontSize: 11 }}>Projects</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{projects.length}</div>
            </Card>
            <Card style={{ padding: "16px" }}>
              <div className={ui.sectionCount} style={{ fontSize: 11 }}>Milestones achieved</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>
                {totals.milestonesAchieved}/{totals.milestonesTotal}
              </div>
            </Card>
            <Card style={{ padding: "16px" }}>
              <div className={ui.sectionCount} style={{ fontSize: 11 }}>Beneficiaries reached</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{totals.beneficiaries}</div>
            </Card>
          </div>
        )}

        {projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            hint="Your administrator hasn't added you to a project's sponsor team yet."
          />
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {projects.map((p) => (
              <a key={p.id} href={`/projects/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Card style={{ padding: "18px 20px", display: "grid", gap: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                      <div className={ui.mono} style={{ marginTop: 2 }}>
                        {p.sponsorName}
                      </div>
                    </div>
                    <StatusBadge status={p.status as "active" | "draft" | "paused"} />
                  </div>
                  <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", fontSize: 12.5, color: "var(--ink-soft)" }}>
                    <span>
                      Milestones: {p.milestonesAchieved}/{p.milestonesTotal} achieved
                    </span>
                    <span>Beneficiaries: {p.beneficiaryCount}</span>
                    <span>Documents: {p.documentCount}</span>
                  </div>
                </Card>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
