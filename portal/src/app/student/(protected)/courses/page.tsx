import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyEnrollments } from "@/lib/courses";
import { Card, EmptyState, Field, Select, StatusBadge, Button, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function MyLearningPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const { status } = await searchParams;
  const filterStatus = status === "active" || status === "completed" || status === "withdrawn" ? status : undefined;

  const enrollments = await listMyEnrollments(actor);
  const visible = filterStatus ? enrollments.filter((e) => e.status === filterStatus) : enrollments;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="My Learning" count={visible.length} />

      <form method="get" className={ui.filterBar}>
        <Field label="Status">
          <Select name="status" defaultValue={filterStatus ?? ""}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="withdrawn">Withdrawn</option>
          </Select>
        </Field>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {visible.length === 0 ? (
        <EmptyState
          title={enrollments.length === 0 ? "Not enrolled in any courses yet" : "No courses match that filter"}
          hint={enrollments.length === 0 ? "Your teacher or an administrator enrolls you into a course." : undefined}
        />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {visible.map((e) => (
            <Card
              key={e.id}
              style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>{e.cohort.course.title}</div>
                <div className={ui.subCell}>
                  {e.cohort.name} · Enrolled {formatDate(e.enrolledAt)}
                  {e.completedAt && ` · Completed ${formatDate(e.completedAt)}`}
                </div>
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
    </div>
  );
}
