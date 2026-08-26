import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAttemptForStudent } from "@/lib/attempts";
import { Banner, Card, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

export default async function StudentResultDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { attemptId } = await params;

  const result = await getAttemptForStudent(attemptId, actor);
  if (!result) return <Banner>Result not found.</Banner>;
  const { attempt, versionTitle, questions } = result;

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "680px" }}>
      <a href="/results" className={ui.linkMono}>
        ← Results
      </a>

      <section>
        <SectionHeader title={versionTitle} count={0} />
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <StatusBadge status={attempt.status} />
          {attempt.status !== "graded" && <span className={ui.mono}>Some answers are still pending your teacher's review.</span>}
          {attempt.scorePercent != null && (
            <span className={ui.mono}>
              {attempt.scorePoints}/{attempt.maxPoints} pts ({Math.round(attempt.scorePercent)}%)
              {attempt.passed != null ? (attempt.passed ? " · Passed" : " · Not passed") : ""}
            </span>
          )}
        </div>
      </section>

      <div style={{ display: "grid", gap: "12px" }}>
        {questions.map((q, i) => (
          <Card key={q.questionId} style={{ padding: "16px", display: "grid", gap: "8px" }}>
            <div className={ui.mono}>
              Question {i + 1} · {q.points} pt{q.points === 1 ? "" : "s"}
            </div>
            <strong>{q.prompt}</strong>

            {q.options.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {q.options.map((o) => {
                  const selected = q.myAnswer?.selectedOptionIds.includes(o.id);
                  return (
                    <li key={o.id} style={{ fontWeight: selected ? 700 : 400 }}>
                      {o.text}
                      {q.graded && o.isCorrect ? " ✓" : ""}
                      {selected ? " ← your answer" : ""}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div>
                <div className={ui.mono}>Your answer:</div>
                <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{q.myAnswer?.textResponse || "(no answer)"}</p>
              </div>
            )}

            {!q.graded && <div className={ui.mono}>Pending grading.</div>}
            {q.graded && q.isCorrect !== undefined && (
              <div className={ui.mono}>
                {q.isCorrect ? "Correct" : "Incorrect"} — {q.awardedPoints} pt{q.awardedPoints === 1 ? "" : "s"}
              </div>
            )}
            {q.graded && q.explanation && (
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
                <span className={ui.mono}>Explanation: </span>
                {q.explanation}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
