import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCourseContentForStudent } from "@/lib/content";
import { AuthorizationError } from "@/lib/authz";
import { Banner, Card, EmptyState, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

export default async function StudentCourseDetailPage({ params }: { params: Promise<{ courseId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { courseId } = await params;

  let course;
  try {
    course = await getCourseContentForStudent(courseId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You&apos;re not enrolled in this course, or it isn&apos;t available.</Banner>;
    }
    throw err;
  }
  if (!course) return <Banner>Course not found.</Banner>;

  const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons.length, 0);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <a href="/courses" className={ui.linkMono}>
        ← My Learning
      </a>

      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: "19px", fontWeight: 800 }}>{course.title}</h2>
        {course.description && <p style={{ margin: 0, color: "var(--ink-soft)" }}>{course.description}</p>}
        <p className={ui.mono} style={{ marginTop: "8px" }}>
          {course.modules.length} module(s) · {totalLessons} lesson(s) published
        </p>
      </div>

      {course.modules.length === 0 ? (
        <EmptyState
          title="No lessons published yet"
          hint="Your teacher hasn't published any content for this course yet. Check back soon."
        />
      ) : (
        <div style={{ display: "grid", gap: "14px" }}>
          {course.modules.map((module) => (
            <Card key={module.id} style={{ padding: "16px" }}>
              <h3 style={{ margin: "0 0 10px", fontSize: "13.5px", fontWeight: 700 }}>{module.title}</h3>
              {module.lessons.length === 0 ? (
                <p className={ui.mono}>No lessons published in this module yet.</p>
              ) : (
                <div style={{ display: "grid", gap: "6px" }}>
                  {module.lessons.map((lesson) => (
                    <a
                      key={lesson.id}
                      href={`/courses/${course.id}/lessons/${lesson.id}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        textDecoration: "none",
                        color: "var(--ink)",
                      }}
                    >
                      <span>{lesson.title}</span>
                      <span className={ui.mono}>{lesson.resources.length} resource(s) →</span>
                    </a>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Banner variant="success">
        <StatusBadge status="published" /> &nbsp;Only published content is shown here — anything still in draft on
        the teacher&apos;s side stays invisible, enforced server-side and independently at the database layer.
      </Banner>
    </div>
  );
}
