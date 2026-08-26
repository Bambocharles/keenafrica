import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { getAttemptForTeacher } from "@/lib/attempts";
import { Banner, Button, Card, Input, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { gradeAttemptAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to grade this attempt.",
  action_failed: "That action could not be completed.",
};

export default async function TeacherAttemptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; attemptId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { id: assessmentId, attemptId } = await params;
  const { error } = await searchParams;

  let result;
  try {
    result = await getAttemptForTeacher(attemptId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>You are not assigned to teach this course.</Banner>;
    throw err;
  }
  if (!result) return <Banner>Attempt not found.</Banner>;

  const { attempt, questions } = result;
  const pending = questions.filter((q) => q.myAnswer && q.isCorrect === undefined);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href={`/assessments/${assessmentId}`} className={ui.linkMono}>
        ← {attempt.assessment.title}
      </a>

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title={`${attempt.student.name}'s attempt #${attempt.attemptNumber}`} count={0} />
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <StatusBadge status={attempt.status} />
          {attempt.scorePercent != null && (
            <span className={ui.mono}>
              {attempt.scorePoints}/{attempt.maxPoints} pts ({Math.round(attempt.scorePercent)}%)
              {attempt.passed != null ? (attempt.passed ? " · Passed" : " · Not passed") : ""}
            </span>
          )}
        </div>
      </section>

      <form action={gradeAttemptAction} style={{ display: "grid", gap: "14px" }}>
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <input type="hidden" name="attemptId" value={attemptId} />

        {questions.map((q) => (
          <Card key={q.questionId} style={{ padding: "16px", display: "grid", gap: "8px" }}>
            <div className={ui.mono}>
              {q.type} · {q.points} pt{q.points === 1 ? "" : "s"}
            </div>
            <strong>{q.prompt}</strong>

            {q.options.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {q.options.map((o) => {
                  const selected = q.myAnswer?.selectedOptionIds.includes(o.id);
                  return (
                    <li key={o.id} style={{ fontWeight: selected ? 700 : 400 }}>
                      {o.text} {o.isCorrect ? "✓" : ""} {selected ? "← student's answer" : ""}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div>
                <div className={ui.mono}>Student's answer:</div>
                <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{q.myAnswer?.textResponse || "(no answer)"}</p>
              </div>
            )}

            {q.isCorrect !== undefined ? (
              <div className={ui.mono}>
                {q.isCorrect ? "Correct" : "Incorrect"} — {q.awardedPoints} pt{q.awardedPoints === 1 ? "" : "s"} awarded
              </div>
            ) : q.myAnswer ? (
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <input type="hidden" name="pendingQuestionId" value={q.questionId} />
                <label className={ui.mono} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <input type="radio" name={`isCorrect_${q.questionId}`} value="true" required /> Correct
                </label>
                <label className={ui.mono} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <input type="radio" name={`isCorrect_${q.questionId}`} value="false" defaultChecked /> Incorrect
                </label>
                <Input
                  type="number"
                  min={0}
                  max={q.points}
                  name={`awardedPoints_${q.questionId}`}
                  defaultValue={0}
                  style={{ width: "70px" }}
                  aria-label="Points awarded"
                />
              </div>
            ) : (
              <div className={ui.mono}>Not answered.</div>
            )}

            {q.explanation && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
                <span className={ui.mono}>Explanation: </span>
                {q.explanation}
              </div>
            )}
          </Card>
        ))}

        {pending.length > 0 && (
          <Button type="submit" variant="primary" style={{ width: "fit-content" }}>
            Save grades{pending.length === questions.length ? " (finalizes attempt)" : ""}
          </Button>
        )}
      </form>
    </div>
  );
}
