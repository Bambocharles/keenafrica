import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthorizationError } from "@/lib/authz";
import { listCohortsForCourse, listEnrollmentsForCohort } from "@/lib/courses";
import { getAssessmentById, listAssignmentsForAssessment } from "@/lib/assessments";
import { listAttemptsForAssessment } from "@/lib/attempts";
import { listQuestionBank } from "@/lib/questions";
import { Banner, Button, Card, EmptyState, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import {
  addExistingQuestionAction,
  archiveAssessmentAction,
  assignToCohortAction,
  assignToStudentAction,
  createAndAddQuestionAction,
  moveQuestionAction,
  publishAssessmentAction,
  removeQuestionAction,
  unassignAction,
  updateAssessmentAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "That field is required.",
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed — check the assessment has at least one question, or that options/answer shape is valid.",
};

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function TeacherAssessmentDetailPage({
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

  let assessment;
  try {
    assessment = await getAssessmentById(assessmentId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>You are not assigned to teach this course.</Banner>;
    throw err;
  }
  if (!assessment) return <Banner>Assessment not found.</Banner>;

  const [bank, cohorts, assignments, attempts] = await Promise.all([
    listQuestionBank(assessment.courseId, {}, actor),
    listCohortsForCourse(assessment.courseId, actor),
    listAssignmentsForAssessment(assessmentId, actor),
    listAttemptsForAssessment(assessmentId, actor),
  ]);
  const rosters = await Promise.all(
    cohorts.map(async (c) => ({ cohortId: c.id, enrollments: await listEnrollmentsForCohort(c.id, actor) }))
  );
  const students = rosters.flatMap((r) => r.enrollments.map((e) => e.student));
  const uniqueStudents = [...new Map(students.map((s) => [s.id, s])).values()];

  const attachedQuestionIds = new Set(assessment.questions.map((aq) => aq.questionId));
  const availableBankQuestions = bank.filter((q) => !attachedQuestionIds.has(q.id) && !q.archivedAt);

  return (
    <div style={{ display: "grid", gap: "28px" }}>
      <a href="/assessments" className={ui.linkMono}>
        ← Assessments
      </a>

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader
          title={assessment.title}
          count={0}
          action={
            <div style={{ display: "flex", gap: "8px" }}>
              {assessment.status !== "archived" && (
                <form action={publishAssessmentAction}>
                  <input type="hidden" name="assessmentId" value={assessmentId} />
                  <Button type="submit" variant="primary" disabled={assessment.questions.length === 0}>
                    {assessment.status === "published" ? "Re-publish (new version)" : "Publish"}
                  </Button>
                </form>
              )}
              {assessment.status !== "archived" && (
                <form action={archiveAssessmentAction}>
                  <input type="hidden" name="assessmentId" value={assessmentId} />
                  <Button type="submit" variant="danger">
                    Archive
                  </Button>
                </form>
              )}
            </div>
          }
        />
        <div style={{ display: "flex", gap: "10px", alignItems: "center", margin: "4px 0 16px" }}>
          <StatusBadge status={assessment.status} />
          <span className={ui.mono}>version {assessment.version}</span>
          {assessment.questions.length === 0 && <span className={ui.mono}>— add a question before publishing</span>}
        </div>

        <Card style={{ padding: "20px" }}>
          <form action={updateAssessmentAction} style={{ display: "grid", gap: "12px", maxWidth: "560px" }}>
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <Field label="Title">
              <Input name="title" defaultValue={assessment.title} required />
            </Field>
            <Field label="Instructions">
              <textarea name="instructions" defaultValue={assessment.instructions} rows={3} className={ui.input} style={{ resize: "vertical", fontFamily: "var(--font-sans)" }} />
            </Field>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Field label="Time limit (minutes)">
                <Input type="number" min={1} name="timeLimitMinutes" defaultValue={assessment.timeLimitMinutes ?? ""} />
              </Field>
              <Field label="Max attempts">
                <Input type="number" min={1} name="maxAttempts" defaultValue={assessment.maxAttempts ?? ""} />
              </Field>
              <Field label="Passing score (%)">
                <Input type="number" min={0} max={100} name="passingScorePercent" defaultValue={assessment.passingScorePercent ?? ""} />
              </Field>
            </div>
            <Button type="submit" variant="secondary" style={{ width: "fit-content" }}>
              Save settings
            </Button>
          </form>
        </Card>
      </section>

      <section>
        <SectionHeader title="Questions" count={assessment.questions.length} />
        {assessment.questions.length === 0 ? (
          <EmptyState title="No questions yet" hint="Create one below or add from the question bank." />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {assessment.questions.map((aq, i) => (
              <Card key={aq.questionId} style={{ padding: "14px 16px", display: "grid", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start" }}>
                  <div>
                    <div className={ui.mono} style={{ marginBottom: "2px" }}>
                      {aq.question.type} · {aq.points} pt{aq.points === 1 ? "" : "s"} · {aq.question.difficulty}
                    </div>
                    <strong>{aq.question.prompt}</strong>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <form action={moveQuestionAction}>
                      <input type="hidden" name="assessmentId" value={assessmentId} />
                      <input type="hidden" name="questionId" value={aq.questionId} />
                      <input type="hidden" name="direction" value="up" />
                      <Button type="submit" variant="ghost" disabled={i === 0}>
                        ↑
                      </Button>
                    </form>
                    <form action={moveQuestionAction}>
                      <input type="hidden" name="assessmentId" value={assessmentId} />
                      <input type="hidden" name="questionId" value={aq.questionId} />
                      <input type="hidden" name="direction" value="down" />
                      <Button type="submit" variant="ghost" disabled={i === assessment.questions.length - 1}>
                        ↓
                      </Button>
                    </form>
                    <form action={removeQuestionAction}>
                      <input type="hidden" name="assessmentId" value={assessmentId} />
                      <input type="hidden" name="questionId" value={aq.questionId} />
                      <Button type="submit" variant="danger">
                        Remove
                      </Button>
                    </form>
                  </div>
                </div>
                {aq.question.options.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {aq.question.options.map((o) => (
                      <li key={o.id} className={o.isCorrect ? undefined : ui.mono}>
                        {o.text} {o.isCorrect ? "✓" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}

        {availableBankQuestions.length > 0 && (
          <Card style={{ padding: "16px", marginTop: "14px" }}>
            <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: 700 }}>Add from question bank</h4>
            <form action={addExistingQuestionAction} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <Field label="Question">
                <select name="questionId" required className={ui.input}>
                  {availableBankQuestions.map((q) => (
                    <option key={q.id} value={q.id}>
                      [{q.type}] {q.prompt.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Points">
                <Input type="number" min={1} name="points" defaultValue={1} style={{ width: "80px" }} />
              </Field>
              <Button type="submit" variant="secondary">
                Add
              </Button>
            </form>
          </Card>
        )}

        <Card style={{ padding: "16px", marginTop: "14px" }}>
          <h4 style={{ margin: "0 0 10px", fontSize: "13px", fontWeight: 700 }}>Create a new question</h4>
          <form action={createAndAddQuestionAction} style={{ display: "grid", gap: "10px", maxWidth: "620px" }}>
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="courseId" value={assessment.courseId} />
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Field label="Type">
                <Select name="type" defaultValue="single_choice">
                  <option value="single_choice">Single choice</option>
                  <option value="multiple_choice">Multiple choice</option>
                  <option value="short_answer">Short answer</option>
                </Select>
              </Field>
              <Field label="Difficulty">
                <Select name="difficulty" defaultValue="medium">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>
              <Field label="Points">
                <Input type="number" min={1} name="points" defaultValue={1} style={{ width: "80px" }} />
              </Field>
            </div>
            <Field label="Prompt">
              <textarea name="prompt" rows={2} required className={ui.input} style={{ resize: "vertical", fontFamily: "var(--font-sans)" }} />
            </Field>
            <Field label="Explanation (shown with results)">
              <textarea name="explanation" rows={2} className={ui.input} style={{ resize: "vertical", fontFamily: "var(--font-sans)" }} />
            </Field>
            <Field label="Learning objective / curriculum reference (optional)">
              <Input name="learningObjective" />
            </Field>

            <div className={ui.mono}>Choice options (leave blank to skip a slot) — check the correct one(s):</div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <Input name={`optionText${i}`} placeholder={`Option ${i + 1}`} style={{ flex: 1 }} />
                <label className={ui.mono} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <input type="checkbox" name={`optionCorrect${i}`} /> correct
                </label>
              </div>
            ))}

            <Field label="Short-answer acceptable answers (comma-separated, optional — otherwise graded manually)">
              <Input name="acceptableAnswers" placeholder="e.g. Lagos, lagos nigeria" />
            </Field>

            <Button type="submit" variant="primary" style={{ width: "fit-content" }}>
              Create &amp; add to assessment
            </Button>
          </form>
        </Card>
      </section>

      <section>
        <SectionHeader title="Assignments" count={assignments.length} />
        {assessment.status !== "published" ? (
          <Banner>Publish this assessment before assigning it.</Banner>
        ) : (
          <>
            {assignments.length === 0 ? (
              <EmptyState title="Not assigned to anyone yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Assigned to</th>
                    <th>Due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td className={ui.nameCell}>{a.cohort ? `Cohort: ${a.cohort.name}` : `${a.student?.name} (${a.student?.email})`}</td>
                      <td className={ui.mono}>{formatDate(a.dueAt)}</td>
                      <td>
                        <form action={unassignAction}>
                          <input type="hidden" name="assessmentId" value={assessmentId} />
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <Button type="submit" variant="danger">
                            Unassign
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginTop: "14px" }}>
              <Card style={{ padding: "14px 16px" }}>
                <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700 }}>Assign to a cohort</h4>
                <form action={assignToCohortAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <input type="hidden" name="assessmentId" value={assessmentId} />
                  <Field label="Cohort">
                    <select name="cohortId" required className={ui.input}>
                      {cohorts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Due (optional)">
                    <Input type="date" name="dueAt" />
                  </Field>
                  <Button type="submit" variant="secondary">
                    Assign
                  </Button>
                </form>
              </Card>

              {uniqueStudents.length > 0 && (
                <Card style={{ padding: "14px 16px" }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 700 }}>Assign to one student</h4>
                  <form action={assignToStudentAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <input type="hidden" name="assessmentId" value={assessmentId} />
                    <Field label="Student">
                      <select name="studentUserId" required className={ui.input}>
                        {uniqueStudents.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.email})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Due (optional)">
                      <Input type="date" name="dueAt" />
                    </Field>
                    <Button type="submit" variant="secondary">
                      Assign
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          </>
        )}
      </section>

      <section>
        <SectionHeader title="Attempts & grading" count={attempts.length} />
        {attempts.length === 0 ? (
          <EmptyState title="No attempts yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Student</th>
                <th>#</th>
                <th>Status</th>
                <th>Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td className={ui.nameCell}>
                    {a.student.name}
                    <span className={ui.subCell}>{a.student.email}</span>
                  </td>
                  <td className={ui.mono}>{a.attemptNumber}</td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className={ui.mono}>{a.scorePercent != null ? `${Math.round(a.scorePercent)}%` : "—"}</td>
                  <td>
                    <a href={`/assessments/${assessmentId}/attempts/${a.id}`} className={ui.linkMono}>
                      {a.status === "submitted" ? "Grade" : "View"} →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
