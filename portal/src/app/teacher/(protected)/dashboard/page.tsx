import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listMyCourses, listCohortsForCourse } from "@/lib/courses";
import { Banner, Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

export default async function TeacherDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const courses = await listMyCourses(actor);
  const withCohorts = await Promise.all(
    courses.map(async (c) => ({
      course: c,
      cohorts: await listCohortsForCourse(c.id, actor),
    }))
  );

  const totalCohorts = withCohorts.reduce((sum, c) => sum + c.cohorts.length, 0);
  const totalStudents = withCohorts.reduce(
    (sum, c) => sum + c.cohorts.reduce((s, cohort) => s + cohort._count.enrollments, 0),
    0
  );

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
        <Card style={{ padding: "16px" }}>
          <div className={ui.mono}>Courses</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{courses.length}</div>
        </Card>
        <Card style={{ padding: "16px" }}>
          <div className={ui.mono}>Cohorts</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{totalCohorts}</div>
        </Card>
        <Card style={{ padding: "16px" }}>
          <div className={ui.mono}>Students</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{totalStudents}</div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Your courses" count={courses.length} />
        {courses.length === 0 ? (
          <EmptyState
            title="No courses assigned yet"
            hint="Ask an admin to assign you to a cohort — see /education in the admin console."
          />
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {withCohorts.map(({ course, cohorts }) => (
              <Card key={course.id} style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <strong>{course.title}</strong>
                    <StatusBadge status={course.status} />
                  </div>
                  <div className={ui.mono}>
                    {cohorts.length} cohort(s) · {cohorts.reduce((s, c) => s + c._count.enrollments, 0)} student(s)
                  </div>
                </div>
                <a className={ui.linkMono} href={`/courses/${course.id}`}>
                  Open →
                </a>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Banner variant="success">
        Publishing a module/lesson makes it visible to enrolled students immediately — there is no separate review
        step in this foundation (see docs/EDUCATION_CORE.md).
      </Banner>
    </div>
  );
}
