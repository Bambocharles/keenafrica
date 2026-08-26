import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyEnrollments } from "@/lib/courses";
import { listMyNotes } from "@/lib/notes";
import { Card, EmptyState, Field, Select, Button, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { deleteNoteAction } from "./actions";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

const TARGET_LABEL: Record<string, string> = {
  course: "Course",
  module: "Module",
  lesson: "Lesson",
  resource: "Resource",
  question: "Question",
};

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { courseId } = await searchParams;

  const [enrollments, notes] = await Promise.all([
    listMyEnrollments(actor),
    listMyNotes({ courseId: courseId || undefined }, actor),
  ]);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Notes" count={notes.length} />

      {enrollments.length > 0 && (
        <form method="get" className={ui.filterBar}>
          <Field label="Course">
            <Select name="courseId" defaultValue={courseId ?? ""}>
              <option value="">All courses</option>
              {enrollments.map((e) => (
                <option key={e.cohort.course.id} value={e.cohort.course.id}>
                  {e.cohort.course.title}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      )}

      {notes.length === 0 ? (
        <EmptyState title="No notes yet" hint="Add notes from any lesson page — they're private and stay attached to that lesson." />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {notes.map((note) => (
            <Card key={note.id} style={{ padding: "14px 16px" }}>
              <div className={ui.subCell} style={{ marginBottom: "6px" }}>
                {note.course.title} · {TARGET_LABEL[note.targetType] ?? note.targetType}
              </div>
              <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>{note.body}</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className={ui.mono}>Updated {formatDateTime(note.updatedAt)}</span>
                <form action={deleteNoteAction}>
                  <input type="hidden" name="noteId" value={note.id} />
                  <button type="submit" className={ui.linkMono} style={{ background: "none", border: "none", cursor: "pointer" }}>
                    Delete
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
