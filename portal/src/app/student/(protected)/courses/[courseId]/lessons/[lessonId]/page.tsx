import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCourseContentForStudent } from "@/lib/content";
import { AuthorizationError } from "@/lib/authz";
import { listMyNotes } from "@/lib/notes";
import { listMyBookmarks } from "@/lib/bookmarks";
import { getCourseProgressForStudent } from "@/lib/progress";
import { Banner, Button, Card, EmptyState } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import {
  addLessonBookmarkAction,
  addLessonNoteAction,
  deleteLessonNoteAction,
  markLessonCompleteAction,
  removeLessonBookmarkAction,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Note text is required.",
  not_authorized: "You are not authorized to do that.",
  action_failed: "That action could not be completed.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function StudentLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { courseId, lessonId } = await params;
  const { error } = await searchParams;

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

  const module = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId));
  const lesson = module?.lessons.find((l) => l.id === lessonId);
  if (!module || !lesson) {
    return <Banner>This lesson isn&apos;t available — it may still be in draft, or doesn&apos;t exist.</Banner>;
  }

  const [notes, bookmarks, progress] = await Promise.all([
    listMyNotes({ courseId, targetType: "lesson", targetId: lessonId }, actor),
    listMyBookmarks({ courseId, targetType: "lesson" }, actor),
    getCourseProgressForStudent(courseId, actor),
  ]);
  const bookmark = bookmarks.find((b) => b.targetId === lessonId);
  const isComplete = progress.modules
    .flatMap((m) => m.lessons)
    .find((l) => l.lessonId === lessonId)?.completed;

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "760px" }}>
      <a href={`/courses/${courseId}`} className={ui.linkMono}>
        ← {course.title}
      </a>

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <div>
        <div className={ui.mono} style={{ marginBottom: "4px" }}>
          {module.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 800 }}>{lesson.title}</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <form action={bookmark ? removeLessonBookmarkAction : addLessonBookmarkAction}>
              <input type="hidden" name="courseId" value={courseId} />
              <input type="hidden" name="lessonId" value={lessonId} />
              {bookmark && <input type="hidden" name="bookmarkId" value={bookmark.id} />}
              <Button type="submit" variant={bookmark ? "secondary" : "outline"}>
                {bookmark ? "★ Saved" : "☆ Save"}
              </Button>
            </form>
            {isComplete ? (
              <Button type="button" variant="secondary" disabled>
                ✓ Completed
              </Button>
            ) : (
              <form action={markLessonCompleteAction}>
                <input type="hidden" name="courseId" value={courseId} />
                <input type="hidden" name="lessonId" value={lessonId} />
                <Button type="submit" variant="primary">
                  Mark complete
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>

      <Card style={{ padding: "20px", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{lesson.content}</Card>

      <section>
        <h3 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 10px" }}>Resources ({lesson.resources.length})</h3>
        {lesson.resources.length === 0 ? (
          <p className={ui.mono}>No resources attached to this lesson.</p>
        ) : (
          <div style={{ display: "grid", gap: "6px" }}>
            {lesson.resources.map((r) => (
              <a
                key={r.id}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className={ui.linkMono}
                style={{ display: "block", padding: "8px 0" }}
              >
                [{r.type}] {r.title} ↗
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 10px" }}>My Notes on This Lesson</h3>
        {notes.length === 0 ? (
          <EmptyState title="No notes yet" hint="Notes are private — only you can see them." />
        ) : (
          <div style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
            {notes.map((note) => (
              <Card key={note.id} style={{ padding: "12px 14px" }}>
                <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{note.body}</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className={ui.mono}>{formatDateTime(note.updatedAt)}</span>
                  <form action={deleteLessonNoteAction}>
                    <input type="hidden" name="courseId" value={courseId} />
                    <input type="hidden" name="lessonId" value={lessonId} />
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

        <form action={addLessonNoteAction} style={{ display: "grid", gap: "8px" }}>
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="lessonId" value={lessonId} />
          <textarea
            name="body"
            rows={3}
            placeholder="Add a private note about this lesson…"
            required
            className={ui.input}
            style={{ resize: "vertical", fontFamily: "var(--font-sans)" }}
          />
          <Button type="submit" variant="primary" style={{ width: "fit-content" }}>
            Add note
          </Button>
        </form>
      </section>
    </div>
  );
}
