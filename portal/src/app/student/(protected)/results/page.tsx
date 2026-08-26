import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyResults } from "@/lib/attempts";
import { Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function StudentResultsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const results = await listMyResults(actor);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Results" count={results.length} />

      {results.length === 0 ? (
        <EmptyState title="No attempts yet" hint="Results appear here once you attempt an assigned assessment." />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {results.map((a) => (
            <a key={a.id} href={`/results/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Card style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <div className={ui.mono}>{a.assessment.course.title}</div>
                  <strong>{a.assessment.title}</strong>
                  <div className={ui.mono}>Attempt #{a.attemptNumber} · {formatDateTime(a.startedAt)}</div>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <StatusBadge status={a.status} />
                  {a.scorePercent != null && <span className={ui.mono}>{Math.round(a.scorePercent)}%</span>}
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
