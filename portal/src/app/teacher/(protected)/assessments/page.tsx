import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyCourses } from "@/lib/courses";
import { Banner, EmptyState, SectionHeader, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

/**
 * Entry point only — Session 07 (Assessment) owns Assessment/Question/
 * Attempt/Answer/Result, which do not exist yet. Per CLAUDE_BUILD_RULES.md
 * §2, this screen does not build a parallel "quiz" model; it lists the
 * courses a teacher could author an assessment for today and documents the
 * expected contract (see docs/TEACHER.md), so Session 07 has a concrete
 * caller to design against and this workspace has a real link to update
 * once that module lands.
 *
 * Expected contract (sessions/07-assessment.md): teacher creates ->
 * draft -> publish -> assign to cohort/students -> student attempts ->
 * submit -> grade -> results, e.g. `createAssessment(courseId, input, actor)`
 * / `publishAssessment(assessmentId, actor)`, ownership-scoped the same way
 * as createModule()/publishModule() (courses.content.write/publish +
 * cohort_teachers), reusing the Topic/LessonTopic taxonomy for question
 * tagging rather than a parallel one.
 */
export default async function TeacherAssessmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const courses = await listMyCourses(actor);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="Assessments" count={0} />

      <Banner>
        Assessment authoring is not available yet. Session 07 (Assessment) owns the Assessment/Question/Attempt/
        Result model and the create → draft → publish → assign → attempt → grade workflow. This page is the wired
        entry point — reported BLOCKED rather than building a separate quiz engine here, per
        CLAUDE_BUILD_RULES.md §2.
      </Banner>

      {courses.length === 0 ? (
        <EmptyState title="No courses assigned yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Assessments</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td className={ui.nameCell}>{c.title}</td>
                <td className={ui.mono}>Not available yet</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
