import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyCourses } from "@/lib/courses";
import { listAssessmentsForCourse } from "@/lib/assessments";
import { Banner, Button, EmptyState, Field, Input, SectionHeader, Table, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { createAssessmentAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Title and course are required.",
  not_authorized: "You do not have permission to do that.",
  action_failed: "That action could not be completed.",
};

export default async function TeacherAssessmentsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { error } = await searchParams;

  const courses = await listMyCourses(actor);
  const assessmentsByCourse = await Promise.all(
    courses.map(async (c) => ({ course: c, assessments: await listAssessmentsForCourse(c.id, actor) }))
  );
  const totalAssessments = assessmentsByCourse.reduce((sum, c) => sum + c.assessments.length, 0);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="Assessments" count={totalAssessments} />

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      {courses.length === 0 ? (
        <EmptyState title="No courses assigned yet" />
      ) : (
        <>
          <section>
            <h3 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 10px" }}>New assessment</h3>
            <form action={createAssessmentAction} style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Course">
                <select name="courseId" required className={ui.input}>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Title">
                <Input name="title" placeholder="e.g. Module 1 Quiz" required />
              </Field>
              <Button type="submit" variant="primary">
                Create draft
              </Button>
            </form>
          </section>

          {assessmentsByCourse.map(({ course, assessments }) => (
            <section key={course.id}>
              <SectionHeader title={course.title} count={assessments.length} />
              {assessments.length === 0 ? (
                <EmptyState title="No assessments yet" hint="Create one above to get started." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Questions</th>
                      <th>Assignments</th>
                      <th>Attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assessments.map((a) => (
                      <tr key={a.id}>
                        <td className={ui.nameCell}>
                          <a href={`/assessments/${a.id}`} className={ui.linkMono}>
                            {a.title}
                          </a>
                        </td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td className={ui.mono}>{a._count.questions}</td>
                        <td className={ui.mono}>{a._count.assignments}</td>
                        <td className={ui.mono}>{a._count.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
