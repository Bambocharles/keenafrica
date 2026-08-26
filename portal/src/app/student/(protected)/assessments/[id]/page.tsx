import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyAssignedAssessments } from "@/lib/assessments";
import { getInProgressAttempt } from "@/lib/attempts";
import { Banner, Button, Card, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { startAttemptAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "This assessment isn't assigned to you, or you've reached the maximum number of attempts.",
  action_failed: "That action could not be completed.",
};

export default async function StudentAssessmentInfoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { id: assessmentId } = await params;
  const { error } = await searchParams;

  const assigned = await listMyAssignedAssessments(actor);
  const entry = assigned.find((a) => a.assessment.id === assessmentId);
  if (!entry) return <Banner>This assessment isn&apos;t assigned to you, or isn&apos;t available.</Banner>;

  const { assessment, attempts } = entry;
  const inProgress = await getInProgressAttempt(assessmentId, actor);
  const latest = attempts[0] ?? null;
  const attemptsLeft = assessment.maxAttempts == null ? null : assessment.maxAttempts - attempts.length;
  const canStart = !inProgress && (attemptsLeft == null || attemptsLeft > 0);

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "640px" }}>
      <a href="/assessments" className={ui.linkMono}>
        ← Assignments
      </a>

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <div>
        <div className={ui.mono}>{assessment.course.title}</div>
        <h2 style={{ margin: "2px 0 8px", fontSize: "19px", fontWeight: 800 }}>{assessment.title}</h2>
      </div>

      {assessment.instructions && <Card style={{ padding: "16px", whiteSpace: "pre-wrap" }}>{assessment.instructions}</Card>}

      <div className={ui.mono} style={{ display: "grid", gap: "4px" }}>
        {assessment.timeLimitMinutes != null && <div>Time limit: {assessment.timeLimitMinutes} minutes</div>}
        <div>Attempts: {attempts.length}{assessment.maxAttempts != null ? ` of ${assessment.maxAttempts}` : ""}</div>
        {assessment.passingScorePercent != null && <div>Passing score: {assessment.passingScorePercent}%</div>}
      </div>

      {latest && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className={ui.mono}>Most recent attempt:</span>
          <StatusBadge status={latest.status} />
          {latest.status !== "in_progress" && (
            <a href={`/results/${latest.id}`} className={ui.linkMono}>
              View result →
            </a>
          )}
        </div>
      )}

      {inProgress ? (
        <form action={startAttemptAction}>
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <Button type="submit" variant="primary">
            Resume attempt
          </Button>
        </form>
      ) : canStart ? (
        <form action={startAttemptAction}>
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <Button type="submit" variant="primary">
            {latest ? "Start new attempt" : "Start attempt"}
          </Button>
        </form>
      ) : (
        <Banner>You&apos;ve used all available attempts for this assessment.</Banner>
      )}
    </div>
  );
}
