import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyCourses } from "@/lib/courses";
import { EmptyState, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function TeacherCoursesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const courses = await listMyCourses(actor);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="My courses" count={courses.length} />

      {courses.length === 0 ? (
        <EmptyState
          title="No courses assigned yet"
          hint="You'll see a course here once an admin assigns you to one of its cohorts."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td className={ui.nameCell}>{c.title}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td className={ui.mono}>{formatDate(c.createdAt)}</td>
                <td>
                  <a className={ui.linkMono} href={`/courses/${c.id}`}>
                    Manage →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
