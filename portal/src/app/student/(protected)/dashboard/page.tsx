import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyEnrollments } from "@/lib/courses";
import { listMyNotes } from "@/lib/notes";
import { listMyBookmarks } from "@/lib/bookmarks";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

const cardStyle = { padding: "18px", display: "grid", gap: "6px" } as const;
const cardLabelStyle = { fontSize: "11px", fontWeight: 700, color: "var(--ink-faint)", textTransform: "uppercase" as const, letterSpacing: "0.04em" };
const cardValueStyle = { fontSize: "22px", fontWeight: 800, color: "var(--ink)" };

export default async function StudentDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const [enrollments, notes, bookmarks] = await Promise.all([
    listMyEnrollments(actor),
    listMyNotes({}, actor),
    listMyBookmarks({}, actor),
  ]);

  const active = enrollments.filter((e) => e.status === "active");
  const completed = enrollments.filter((e) => e.status === "completed");

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
        <Card style={cardStyle}>
          <span style={cardLabelStyle}>My Courses</span>
          <span style={cardValueStyle}>{enrollments.length}</span>
        </Card>
        <Card style={cardStyle}>
          <span style={cardLabelStyle}>In Progress</span>
          <span style={cardValueStyle}>{active.length}</span>
        </Card>
        <Card style={cardStyle}>
          <span style={cardLabelStyle}>Completed</span>
          <span style={cardValueStyle}>{completed.length}</span>
        </Card>
        <Card style={cardStyle}>
          <span style={cardLabelStyle}>Notes</span>
          <span style={cardValueStyle}>{notes.length}</span>
        </Card>
        <Card style={cardStyle}>
          <span style={cardLabelStyle}>Saved</span>
          <span style={cardValueStyle}>{bookmarks.length}</span>
        </Card>
      </section>

      <section>
        <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px" }}>Continue Learning</h2>
        {active.length === 0 ? (
          <EmptyState
            title="No courses in progress"
            hint="Once you're enrolled in a course, it will show up here so you can pick up where you left off."
          />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {active.map((e) => (
              <Card key={e.id} style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{e.cohort.course.title}</div>
                  <div className={ui.subCell}>Enrolled {formatDate(e.enrolledAt)} · {e.cohort.name}</div>
                </div>
                <a className={ui.linkMono} href={`/courses/${e.cohort.course.id}`}>
                  Continue →
                </a>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px" }}>My Courses</h2>
        {enrollments.length === 0 ? (
          <EmptyState title="Not enrolled in any courses yet" hint="Your teacher or an administrator enrolls you into a course." />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {enrollments.map((e) => (
              <Card key={e.id} style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{e.cohort.course.title}</div>
                  <div className={ui.subCell}>{e.cohort.name}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <StatusBadge status={e.status} />
                  <a className={ui.linkMono} href={`/courses/${e.cohort.course.id}`}>
                    Open →
                  </a>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
