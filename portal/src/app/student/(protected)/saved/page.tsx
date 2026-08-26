import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyBookmarks } from "@/lib/bookmarks";
import { getCourseContentForStudent } from "@/lib/content";
import { Card, EmptyState, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { removeSavedBookmarkAction } from "./actions";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function SavedPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const bookmarks = await listMyBookmarks({}, actor);
  const courseIds = Array.from(new Set(bookmarks.map((b) => b.courseId)));
  const courses = await Promise.all(courseIds.map((id) => getCourseContentForStudent(id, actor)));

  type Resolved = { title: string; href: string };
  const resolved = new Map<string, Resolved>();
  for (const course of courses) {
    if (!course) continue;
    for (const module of course.modules) {
      for (const lesson of module.lessons) {
        resolved.set(`lesson:${lesson.id}`, { title: lesson.title, href: `/courses/${course.id}/lessons/${lesson.id}` });
        for (const resource of lesson.resources) {
          resolved.set(`resource:${resource.id}`, { title: resource.title, href: `/courses/${course.id}/lessons/${lesson.id}` });
        }
      }
    }
  }

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Saved Resources" count={bookmarks.length} />

      {bookmarks.length === 0 ? (
        <EmptyState title="Nothing saved yet" hint="Save a lesson from its page to find it here quickly later." />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {bookmarks.map((b) => {
            const target = resolved.get(`${b.targetType}:${b.targetId}`);
            return (
              <Card key={b.id} style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{target?.title ?? "(no longer available)"}</div>
                  <div className={ui.subCell}>
                    {b.course.title} · {b.targetType} · Saved {formatDate(b.createdAt)}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {target && (
                    <a className={ui.linkMono} href={target.href}>
                      Open →
                    </a>
                  )}
                  <form action={removeSavedBookmarkAction}>
                    <input type="hidden" name="bookmarkId" value={b.id} />
                    <button type="submit" className={ui.linkMono} style={{ background: "none", border: "none", cursor: "pointer" }}>
                      Remove
                    </button>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
