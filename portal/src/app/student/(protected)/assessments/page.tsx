import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyAssignedAssessments } from "@/lib/assessments";
import { Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date | null) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function StudentAssessmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const assigned = await listMyAssignedAssessments(actor);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Assignments" count={assigned.length} />

      {assigned.length === 0 ? (
        <EmptyState title="No assessments assigned yet" hint="Your teacher will assign quizzes and tests here." />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {assigned.map(({ assessment, assignment, attempts }) => {
            const latest = attempts[0] ?? null;
            const inProgress = latest?.status === "in_progress";
            const attemptsUsed = attempts.length;
            const attemptsLeft = assessment.maxAttempts == null ? Infinity : assessment.maxAttempts - attemptsUsed;
            const canStartOrRetake = !inProgress && attemptsLeft > 0;

            return (
              <Card key={assessment.id} style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <div className={ui.mono}>{assessment.course.title}</div>
                  <strong>{assessment.title}</strong>
                  {assignment.dueAt && <div className={ui.mono}>Due {formatDate(assignment.dueAt)}</div>}
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  {latest && <StatusBadge status={latest.status} />}
                  {latest && !inProgress && (
                    <a href={`/results/${latest.id}`} className={ui.linkMono}>
                      View result →
                    </a>
                  )}
                  {inProgress && (
                    <a href={`/assessments/${assessment.id}`} className={ui.linkMono}>
                      Resume →
                    </a>
                  )}
                  {canStartOrRetake && (
                    <a href={`/assessments/${assessment.id}`} className={ui.linkMono}>
                      {latest ? "Retake →" : "Start →"}
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
