import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyEnrollments } from "@/lib/courses";
import { getCourseContentForStudent } from "@/lib/content";
import { Banner, Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/**
 * There is no canonical Progress/completion-tracking model yet — Session 08
 * (Progress & Adaptive Learning) owns "lesson/module/course progress" and
 * "completion tracking" per its spec, and Session 04's own handoff says as
 * much ("Enrollment.completedAt exists in the schema but nothing sets it
 * yet — needs a Progress model"). Per CLAUDE_BUILD_RULES.md §2 and this
 * session's explicit "Must NOT calculate authoritative mastery locally,"
 * this page does NOT invent a completion percentage or mastery score. It
 * shows only real, canonical Enrollment data (status/enrolledAt/
 * completedAt) plus how much published content exists — informational
 * context, not a claim about how much of it the student has completed.
 */
export default async function ProgressPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const enrollments = await listMyEnrollments(actor);
  const courses = await Promise.all(enrollments.map((e) => getCourseContentForStudent(e.cohort.course.id, actor)));

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="My Progress" count={enrollments.length} />

      <Banner>
        Detailed lesson-by-lesson completion and mastery tracking isn&apos;t available yet — that&apos;s owned by
        Session 08 (Progress &amp; Adaptive Learning), which hasn&apos;t been built. What&apos;s shown below is your
        real enrollment status only, not a calculated completion percentage.
      </Banner>

      {enrollments.length === 0 ? (
        <EmptyState title="Not enrolled in any courses yet" />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {enrollments.map((e, i) => {
            const course = courses[i];
            const totalLessons = course?.modules.reduce((sum, m) => sum + m.lessons.length, 0) ?? 0;
            return (
              <Card key={e.id} style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{e.cohort.course.title}</div>
                    <div className={ui.subCell}>{e.cohort.name}</div>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
                <div className={ui.mono} style={{ marginTop: "10px" }}>
                  Enrolled {formatDate(e.enrolledAt)}
                  {e.completedAt && ` · Completed ${formatDate(e.completedAt)}`}
                  {e.withdrawnAt && ` · Withdrawn ${formatDate(e.withdrawnAt)}`}
                  {" · "}
                  {course?.modules.length ?? 0} module(s), {totalLessons} lesson(s) published
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
