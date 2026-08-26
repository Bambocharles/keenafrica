import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAttemptForStudent, getInProgressAttempt } from "@/lib/attempts";
import { Banner, Button, Card } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { submitAttemptAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "This attempt has already been submitted.",
  action_failed: "That action could not be completed.",
};

export default async function StudentLiveAttemptPage({
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

  const inProgress = await getInProgressAttempt(assessmentId, actor);
  if (!inProgress) {
    return (
      <Banner>
        No active attempt for this assessment. <a href={`/assessments/${assessmentId}`}>Go back and start one</a>.
      </Banner>
    );
  }

  const result = await getAttemptForStudent(inProgress.id, actor);
  if (!result) return <Banner>Attempt not found.</Banner>;
  const { attempt, versionTitle, versionInstructions, questions } = result;

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "680px" }}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: "19px", fontWeight: 800 }}>{versionTitle}</h2>
        {versionInstructions && <p className={ui.mono}>{versionInstructions}</p>}
      </div>

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <form action={submitAttemptAction} style={{ display: "grid", gap: "16px" }}>
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <input type="hidden" name="attemptId" value={attempt.id} />

        {questions.map((q, i) => (
          <Card key={q.questionId} style={{ padding: "16px", display: "grid", gap: "10px" }}>
            <input type="hidden" name="questionId" value={q.questionId} />
            <div className={ui.mono}>
              Question {i + 1} of {questions.length} · {q.points} pt{q.points === 1 ? "" : "s"}
            </div>
            <strong>{q.prompt}</strong>

            {q.type === "short_answer" ? (
              <textarea
                name={`text_${q.questionId}`}
                defaultValue={q.myAnswer?.textResponse ?? ""}
                rows={3}
                className={ui.input}
                style={{ resize: "vertical", fontFamily: "var(--font-sans)" }}
              />
            ) : (
              <div style={{ display: "grid", gap: "6px" }}>
                {q.options.map((o) => (
                  <label key={o.id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type={q.type === "single_choice" ? "radio" : "checkbox"}
                      name={`selected_${q.questionId}`}
                      value={o.id}
                      defaultChecked={q.myAnswer?.selectedOptionIds.includes(o.id)}
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            )}
          </Card>
        ))}

        <Button type="submit" variant="primary" style={{ width: "fit-content" }}>
          Submit
        </Button>
      </form>
    </div>
  );
}
