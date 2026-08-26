import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyEnrollments } from "@/lib/courses";
import { getCourseContentForStudent } from "@/lib/content";
import { Banner, Card, EmptyState, Field, Input, Button, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

/**
 * "Practice independently" (session acceptance criterion): a flat, any-
 * order view of every published lesson across every course the student is
 * (or was) actively enrolled in — distinct from My Learning's per-course
 * module/lesson tree, which implies sequence. No Assessment/Question bank
 * exists yet (Session 07) so this is content review, not graded practice —
 * see /assessments for that entry point.
 */
export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const { q } = await searchParams;
  const query = q?.trim().toLowerCase();

  const enrollments = await listMyEnrollments(actor);
  const eligible = enrollments.filter((e) => e.status === "active" || e.status === "completed");

  const courses = await Promise.all(
    eligible.map((e) => getCourseContentForStudent(e.cohort.course.id, actor))
  );

  type Row = { courseId: string; courseTitle: string; moduleTitle: string; lessonId: string; lessonTitle: string };
  const rows: Row[] = [];
  for (const course of courses) {
    if (!course) continue;
    for (const module of course.modules) {
      for (const lesson of module.lessons) {
        rows.push({
          courseId: course.id,
          courseTitle: course.title,
          moduleTitle: module.title,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
        });
      }
    }
  }

  const visible = query
    ? rows.filter(
        (r) => r.lessonTitle.toLowerCase().includes(query) || r.courseTitle.toLowerCase().includes(query) || r.moduleTitle.toLowerCase().includes(query)
      )
    : rows;

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Practice" count={visible.length} />
      <Banner variant="success">
        Jump into any published lesson from any of your courses, in any order — good for review or independent
        practice, separate from working through a course module-by-module in My Learning.
      </Banner>

      <form method="get" className={ui.filterBar}>
        <Field label="Search">
          <Input name="q" defaultValue={q ?? ""} placeholder="Search lessons, modules, or courses…" />
        </Field>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? "No published lessons yet" : "No matches"}
          hint={rows.length === 0 ? "Once your courses have published content, it will show up here." : "Try a different search term."}
        />
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {visible.map((r) => (
            <Card key={r.lessonId} style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{r.lessonTitle}</div>
                <div className={ui.subCell}>
                  {r.courseTitle} · {r.moduleTitle}
                </div>
              </div>
              <a className={ui.linkMono} href={`/courses/${r.courseId}/lessons/${r.lessonId}`}>
                Open →
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
