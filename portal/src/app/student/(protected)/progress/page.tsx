import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyEnrollments } from "@/lib/courses";
import { getCourseProgressForStudent, getTopicMasteryForStudent } from "@/lib/progress";
import { Banner, Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/**
 * Session 08 (Progress & Adaptive Learning). Replaces Session 06's
 * deliberately-minimal enrollment-status-only stub (see that session's
 * handoff: "once a real Progress/completion model exists, replace its
 * enrollment-only view... do not let this session's provisional view
 * become the de facto contract"). Every number here is read from
 * src/lib/progress.ts, which computes fresh from LessonProgress/Attempt/
 * Answer evidence on every call — nothing is cached or re-derived
 * independently by this page.
 */
export default async function ProgressPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const enrollments = await listMyEnrollments(actor);
  const [courseProgress, mastery] = await Promise.all([
    Promise.all(enrollments.map((e) => getCourseProgressForStudent(e.cohort.course.id, actor))),
    getTopicMasteryForStudent(actor, {}),
  ]);

  const weakTopics = mastery.filter((m) => m.masteryLevel === "weak" || m.masteryLevel === "developing");
  const strongTopics = mastery.filter((m) => m.masteryLevel === "strong");
  const exposureOnlyTopics = mastery.filter((m) => m.masteryLevel === "exposure_only");

  return (
    <div style={{ display: "grid", gap: "28px" }}>
      <SectionHeader title="My Progress" count={enrollments.length} />

      {enrollments.length === 0 ? (
        <EmptyState title="Not enrolled in any courses yet" />
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {enrollments.map((e, i) => {
            const progress = courseProgress[i];
            return (
              <Card key={e.id} style={{ padding: "16px 18px", display: "grid", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{e.cohort.course.title}</div>
                    <div className={ui.subCell}>{e.cohort.name}</div>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, height: "8px", borderRadius: "999px", background: "var(--surface-sunken)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${progress.percentComplete}%`,
                        height: "100%",
                        background: "var(--accent)",
                        borderRadius: "999px",
                      }}
                    />
                  </div>
                  <span className={ui.mono}>{progress.percentComplete}%</span>
                </div>
                <div className={ui.mono}>
                  {progress.completedLessons} of {progress.totalLessons} lesson(s) completed
                  {e.completedAt && ` · Completed ${formatDate(e.completedAt)}`}
                  {e.withdrawnAt && ` · Withdrawn ${formatDate(e.withdrawnAt)}`}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <section>
        <SectionHeader title="Strengths & weak areas" count={mastery.length} />
        {mastery.length === 0 ? (
          <EmptyState
            title="No topic evidence yet"
            hint="Complete a lesson or take a graded assessment tagged to a topic to see your strengths and weak areas here."
          />
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {weakTopics.length > 0 && (
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px" }}>Focus areas</h3>
                <div style={{ display: "grid", gap: "8px" }}>
                  {weakTopics.map((t) => (
                    <Card key={t.topicId} style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{t.topicName}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className={ui.mono}>
                          {t.accuracyPercent}% ({t.correctCount}/{t.totalGraded})
                        </span>
                        <StatusBadge status={t.masteryLevel} />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {strongTopics.length > 0 && (
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px" }}>Strong areas</h3>
                <div style={{ display: "grid", gap: "8px" }}>
                  {strongTopics.map((t) => (
                    <Card key={t.topicId} style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{t.topicName}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className={ui.mono}>
                          {t.accuracyPercent}% ({t.correctCount}/{t.totalGraded})
                        </span>
                        <StatusBadge status={t.masteryLevel} />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {exposureOnlyTopics.length > 0 && (
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 700, margin: "0 0 8px" }}>Covered, not yet assessed</h3>
                <div style={{ display: "grid", gap: "8px" }}>
                  {exposureOnlyTopics.map((t) => (
                    <Card key={t.topicId} style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{t.topicName}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className={ui.mono}>{t.lessonsCompleted} lesson(s) completed</span>
                        <StatusBadge status={t.masteryLevel} />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <Banner variant="success">
          Weak/strong areas are based on graded assessment answers tagged to a topic — never re-graded here, only
          read from Session 07&apos;s existing results. A topic with only completed-lesson exposure and no
          assessment evidence yet is shown separately, never classified weak/strong.
        </Banner>
      </section>
    </div>
  );
}
