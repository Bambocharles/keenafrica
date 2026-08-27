import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listCourses } from "@/lib/courses";
import { AuthorizationError, hasPermission, PERMISSIONS } from "@/lib/authz";
import {
  getAdminCompletionReport,
  getAdminAssessmentOutcomesReport,
  getAdminParticipationReport,
} from "@/lib/reporting";
import { Banner, Button, Card, EmptyState, Field, Input, Select, SectionHeader, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string; from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!user.isSuperAdmin && !hasPermission(user, PERMISSIONS.COURSES_MANAGE)) {
    return <Banner>You do not have permission to view reports (requires courses.manage).</Banner>;
  }

  const params = await searchParams;
  const courseId = params.courseId?.trim() || undefined;
  const from = parseDate(params.from);
  const to = parseDate(params.to);

  let completion, outcomes, participation;
  try {
    [completion, outcomes, participation] = await Promise.all([
      getAdminCompletionReport(user, { courseId, from, to }),
      getAdminAssessmentOutcomesReport(user, { courseId, from, to }),
      getAdminParticipationReport(user, { from, to }),
    ]);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>You do not have permission to view reports.</Banner>;
    throw err;
  }

  const { courses: courseOptions } = await listCourses({ pageSize: 100 }, user);

  const qs = new URLSearchParams();
  if (courseId) qs.set("courseId", courseId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();

  return (
    <div style={{ display: "grid", gap: "32px" }}>
      <section>
        <SectionHeader title="Reports" count={0} />
        <p className={ui.mono} style={{ margin: "4px 0 12px" }}>
          Operational reporting over canonical Education Core / Assessment / Progress data — nothing here is a
          separate analytics store; see docs/REPORTING.md for exact metric definitions.
        </p>

        <form method="get" className={ui.filterBar}>
          <Field label="Course">
            <Select name="courseId" defaultValue={courseId ?? ""}>
              <option value="">All courses</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" name="from" defaultValue={params.from ?? ""} />
          </Field>
          <Field label="To">
            <Input type="date" name="to" defaultValue={params.to ?? ""} />
          </Field>
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
        </form>
      </section>

      <section>
        <SectionHeader
          title="Course completion"
          count={completion.totals.enrollments}
          action={
            <a className={ui.linkMono} href={`/reports/completion/export${query ? `?${query}` : ""}`}>
              Download CSV
            </a>
          }
        />
        <Card style={{ padding: "16px", marginBottom: 12 }}>
          <div className={ui.sectionCount} style={{ fontSize: 11 }}>
            Platform completion rate
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {completion.totals.completionRatePercent}% ({completion.totals.completed}/{completion.totals.enrollments})
          </div>
        </Card>
        {completion.courses.length === 0 ? (
          <EmptyState title="No enrollments in this window" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Enrollments</th>
                <th>Completed</th>
                <th>Active</th>
                <th>Withdrawn</th>
                <th>Completion rate</th>
              </tr>
            </thead>
            <tbody>
              {completion.courses.map((c) => (
                <tr key={c.courseId}>
                  <td className={ui.nameCell}>{c.courseTitle}</td>
                  <td className={ui.mono}>{c.enrollments}</td>
                  <td className={ui.mono}>{c.completed}</td>
                  <td className={ui.mono}>{c.active}</td>
                  <td className={ui.mono}>{c.withdrawn}</td>
                  <td className={ui.mono}>{c.completionRatePercent}%</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeader
          title="Assessment outcomes"
          count={outcomes.totals.attempts}
          action={
            <a className={ui.linkMono} href={`/reports/assessment-outcomes/export${query ? `?${query}` : ""}`}>
              Download CSV
            </a>
          }
        />
        <Card style={{ padding: "16px", marginBottom: 12 }}>
          <div className={ui.sectionCount} style={{ fontSize: 11 }}>
            Avg score / pass rate (graded attempts)
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {outcomes.totals.avgScorePercent ?? "—"}% avg · {outcomes.totals.passRatePercent ?? "—"}% pass
          </div>
          <div className={ui.mono} style={{ marginTop: 4 }}>
            {outcomes.totals.gradedAttempts}/{outcomes.totals.attempts} attempts graded
          </div>
        </Card>
        {outcomes.assessments.length === 0 ? (
          <EmptyState title="No attempts in this window" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Course</th>
                <th>Attempts</th>
                <th>Graded</th>
                <th>Avg score</th>
                <th>Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.assessments.map((a) => (
                <tr key={a.assessmentId}>
                  <td className={ui.nameCell}>{a.assessmentTitle}</td>
                  <td className={ui.mono}>{a.courseTitle}</td>
                  <td className={ui.mono}>{a.attempts}</td>
                  <td className={ui.mono}>{a.gradedAttempts}</td>
                  <td className={ui.mono}>{a.avgScorePercent ?? "—"}%</td>
                  <td className={ui.mono}>{a.passRatePercent ?? "—"}%</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeader
          title="Participation"
          count={participation.totals.activeStudents}
          action={
            <a className={ui.linkMono} href={`/reports/participation/export${query ? `?${query}` : ""}`}>
              Download CSV
            </a>
          }
        />
        <Card style={{ padding: "16px", marginBottom: 12 }}>
          <div className={ui.sectionCount} style={{ fontSize: 11 }}>
            Active students in window
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{participation.totals.activeStudents}</div>
          <div className={ui.mono} style={{ marginTop: 4 }}>
            {participation.totals.lessonsCompleted} lessons completed · {participation.totals.attemptsSubmitted} attempts submitted
          </div>
        </Card>
        {participation.courses.length === 0 ? (
          <EmptyState title="No activity in this window" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Lessons completed</th>
                <th>Attempts submitted</th>
                <th>Active students</th>
              </tr>
            </thead>
            <tbody>
              {participation.courses.map((c) => (
                <tr key={c.courseId}>
                  <td className={ui.nameCell}>{c.courseTitle}</td>
                  <td className={ui.mono}>{c.lessonsCompleted}</td>
                  <td className={ui.mono}>{c.attemptsSubmitted}</td>
                  <td className={ui.mono}>{c.activeStudents}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
