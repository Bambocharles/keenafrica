import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCourseById, listCohortsForCourse, listEnrollmentsForCohort } from "@/lib/courses";
import { getCourseContentForTeacher } from "@/lib/content";
import { listTopics } from "@/lib/topics";
import { getCourseProgressForCohort, getTopicMasteryForCohort } from "@/lib/progress";
import { AuthorizationError } from "@/lib/authz";
import {
  addResourceAction,
  createLessonAction,
  createModuleAction,
  moveLessonAction,
  moveModuleAction,
  publishLessonAction,
  publishModuleAction,
  removeResourceAction,
  tagLessonAction,
  unpublishLessonAction,
  unpublishModuleAction,
  untagLessonAction,
  updateLessonAction,
  updateModuleAction,
  uploadResourceFileAction,
} from "./actions";
import { Banner, Button, Card, Disclosure, EmptyState, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "That field is required.",
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed.",
  unsupported_file_type: "That file type isn't supported, or its content didn't match its extension.",
  file_too_large: "That file is too large.",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function TeacherCourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const { id: courseId } = await params;
  const query = await searchParams;

  let course;
  try {
    course = await getCourseById(courseId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return <Banner>You are not assigned to teach this course.</Banner>;
    }
    throw err;
  }
  if (!course) return <Banner>Course not found.</Banner>;

  // listCohortsForCourse/listEnrollmentsForCohort are RLS-scoped to cohorts
  // this actor actually teaches (cohort_teachers), not every cohort of the
  // course — see docs/TEACHER.md's "cohort visibility" note.
  const cohorts = await listCohortsForCourse(courseId, actor);
  const rosters = await Promise.all(
    cohorts.map(async (c) => ({
      cohortId: c.id,
      enrollments: await listEnrollmentsForCohort(c.id, actor),
      progress: await getCourseProgressForCohort(c.id, actor),
      topicMastery: await getTopicMasteryForCohort(c.id, actor),
    }))
  );

  const content = await getCourseContentForTeacher(courseId, actor);
  const topics = await listTopics();

  return (
    <div style={{ display: "grid", gap: "28px" }}>
      <a href="/courses" className={ui.linkMono}>
        ← My courses
      </a>

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title={course.title} count={0} />
        <Card style={{ padding: "20px", display: "grid", gap: "10px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <StatusBadge status={course.status} />
            <span className={ui.mono}>Created {formatDate(course.createdAt)}</span>
          </div>
          {course.description && <p>{course.description}</p>}
        </Card>
        <Banner variant="success">
          Course-level metadata and publishing (draft → published → archived) is admin-owned (`courses.manage` /
          `courses.publish`) — this workspace only authors the content underneath it.
        </Banner>
      </section>

      <section>
        <SectionHeader title="Cohorts & roster" count={cohorts.length} />
        {cohorts.length === 0 ? (
          <EmptyState title="No cohort assigned" hint="An admin needs to assign you to a cohort of this course first." />
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {cohorts.map((cohort) => {
              const roster = rosters.find((r) => r.cohortId === cohort.id);
              const enrollments = roster?.enrollments ?? [];
              const progressByStudent = new Map((roster?.progress.students ?? []).map((s) => [s.studentId, s]));
              const statusCounts = enrollments.reduce<Record<string, number>>((acc, e) => {
                acc[e.status] = (acc[e.status] ?? 0) + 1;
                return acc;
              }, {});
              return (
                <Card key={cohort.id} style={{ padding: "16px", display: "grid", gap: "10px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{cohort.name}</strong>
                    <StatusBadge status={cohort.status} />
                    <span className={ui.mono}>
                      {enrollments.length} enrolled
                      {Object.entries(statusCounts).map(([s, n]) => ` · ${n} ${s}`).join("")}
                      {roster ? ` · ${roster.progress.totalLessons} lesson(s) published` : ""}
                    </span>
                  </div>
                  {enrollments.length === 0 ? (
                    <EmptyState title="No students enrolled yet" />
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Status</th>
                          <th>Progress</th>
                          <th>Enrolled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrollments.map((e) => {
                          const p = progressByStudent.get(e.studentUserId);
                          return (
                            <tr key={e.id}>
                              <td className={ui.nameCell}>
                                {e.student.name}
                                <span className={ui.subCell}>{e.student.email}</span>
                              </td>
                              <td>
                                <StatusBadge status={e.status} />
                              </td>
                              <td className={ui.mono}>
                                {p ? `${p.completedLessons}/${p.totalLessons} (${p.percentComplete}%)` : "—"}
                              </td>
                              <td className={ui.mono}>{formatDate(e.enrolledAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  )}

                  {(roster?.topicMastery.length ?? 0) > 0 && (
                    <Disclosure label="Topic performance">
                      <Table>
                        <thead>
                          <tr>
                            <th>Topic</th>
                            <th>Cohort accuracy</th>
                            <th>Weak / Strong students</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roster!.topicMastery.map((t) => (
                            <tr key={t.topicId}>
                              <td>{t.topicName}</td>
                              <td className={ui.mono}>
                                {t.cohortAccuracyPercent}% ({t.correctAnswers}/{t.totalGradedAnswers})
                              </td>
                              <td className={ui.mono}>
                                {t.studentsWeak} weak · {t.studentsStrong} strong (of {t.studentsWithEvidence})
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </Disclosure>
                  )}
                </Card>
              );
            })}
          </div>
        )}
        <Banner variant="success">
          Progress is real lesson-completion data (Session 08) driven by the student&apos;s own
          &quot;Mark complete&quot; actions and graded assessment answers — nothing here is estimated or
          duplicated locally; see docs/PROGRESS.md.
        </Banner>
      </section>

      <section>
        <SectionHeader title="Modules & lessons" count={content?.modules.length ?? 0} />

        {(content?.modules.length ?? 0) === 0 ? (
          <EmptyState title="No modules yet" hint="Create a module below to start authoring content." />
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {content!.modules.map((module, mi) => (
              <Card key={module.id} style={{ padding: "16px", display: "grid", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <strong>{module.title}</strong>
                    <StatusBadge status={module.status} />
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <form action={moveModuleAction}>
                      <input type="hidden" name="courseId" value={courseId} />
                      <input type="hidden" name="moduleId" value={module.id} />
                      <input type="hidden" name="direction" value="up" />
                      <Button type="submit" variant="outline" disabled={mi === 0}>
                        ↑
                      </Button>
                    </form>
                    <form action={moveModuleAction}>
                      <input type="hidden" name="courseId" value={courseId} />
                      <input type="hidden" name="moduleId" value={module.id} />
                      <input type="hidden" name="direction" value="down" />
                      <Button type="submit" variant="outline" disabled={mi === content!.modules.length - 1}>
                        ↓
                      </Button>
                    </form>
                    {module.status === "published" ? (
                      <form action={unpublishModuleAction}>
                        <input type="hidden" name="courseId" value={courseId} />
                        <input type="hidden" name="moduleId" value={module.id} />
                        <Button type="submit" variant="outline">
                          Unpublish
                        </Button>
                      </form>
                    ) : (
                      <form action={publishModuleAction}>
                        <input type="hidden" name="courseId" value={courseId} />
                        <input type="hidden" name="moduleId" value={module.id} />
                        <Button type="submit" variant="primary">
                          Publish
                        </Button>
                      </form>
                    )}
                  </div>
                </div>

                <Disclosure label="Edit module title">
                  <form action={updateModuleAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", width: "100%", gridColumn: "1 / -1" }}>
                    <input type="hidden" name="courseId" value={courseId} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <Field label="Title" className={ui.fieldWide}>
                      <Input name="title" defaultValue={module.title} required />
                    </Field>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                </Disclosure>

                <div style={{ display: "grid", gap: "10px", paddingLeft: "12px", borderLeft: "2px solid var(--border)" }}>
                  {module.lessons.length === 0 ? (
                    <EmptyState title="No lessons yet" />
                  ) : (
                    module.lessons.map((lesson, li) => (
                      <Card key={lesson.id} style={{ padding: "14px", display: "grid", gap: "10px", background: "var(--surface-sunken)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <strong>{lesson.title}</strong>
                            <StatusBadge status={lesson.status} />
                            <span className={ui.mono}>v{lesson.version}</span>
                          </div>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <form action={moveLessonAction}>
                              <input type="hidden" name="courseId" value={courseId} />
                              <input type="hidden" name="moduleId" value={module.id} />
                              <input type="hidden" name="lessonId" value={lesson.id} />
                              <input type="hidden" name="direction" value="up" />
                              <Button type="submit" variant="outline" disabled={li === 0}>
                                ↑
                              </Button>
                            </form>
                            <form action={moveLessonAction}>
                              <input type="hidden" name="courseId" value={courseId} />
                              <input type="hidden" name="moduleId" value={module.id} />
                              <input type="hidden" name="lessonId" value={lesson.id} />
                              <input type="hidden" name="direction" value="down" />
                              <Button type="submit" variant="outline" disabled={li === module.lessons.length - 1}>
                                ↓
                              </Button>
                            </form>
                            {lesson.status === "published" ? (
                              <form action={unpublishLessonAction}>
                                <input type="hidden" name="courseId" value={courseId} />
                                <input type="hidden" name="lessonId" value={lesson.id} />
                                <Button type="submit" variant="outline">
                                  Unpublish
                                </Button>
                              </form>
                            ) : (
                              <form action={publishLessonAction}>
                                <input type="hidden" name="courseId" value={courseId} />
                                <input type="hidden" name="lessonId" value={lesson.id} />
                                <Button type="submit" variant="primary">
                                  Publish
                                </Button>
                              </form>
                            )}
                          </div>
                        </div>

                        <Disclosure label="Edit lesson content">
                          <form action={updateLessonAction} style={{ display: "grid", gap: "10px", width: "100%", gridColumn: "1 / -1" }}>
                            <input type="hidden" name="courseId" value={courseId} />
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <Field label="Title" className={ui.fieldWide}>
                              <Input name="title" defaultValue={lesson.title} required />
                            </Field>
                            <Field label="Content" className={ui.fieldWide}>
                              <textarea name="content" defaultValue={lesson.content} required rows={4} className={ui.input} />
                            </Field>
                            <div className={ui.disclosureActions}>
                              <Button type="submit" variant="secondary">
                                Save draft
                              </Button>
                            </div>
                          </form>
                        </Disclosure>

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {lesson.topics.map((lt) => (
                            <span key={lt.topicId} className={ui.roleTag}>
                              {lt.topic.name}
                              <form action={untagLessonAction} style={{ display: "inline" }}>
                                <input type="hidden" name="courseId" value={courseId} />
                                <input type="hidden" name="lessonId" value={lesson.id} />
                                <input type="hidden" name="topicId" value={lt.topicId} />
                                <button type="submit" style={{ marginLeft: 6, cursor: "pointer" }}>
                                  ×
                                </button>
                              </form>
                            </span>
                          ))}
                        </div>
                        {topics.length > 0 && (
                          <form action={tagLessonAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", gridColumn: "1 / -1" }}>
                            <input type="hidden" name="courseId" value={courseId} />
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <Field label="Tag topic">
                              <Select name="topicId" defaultValue="">
                                <option value="" disabled>
                                  Choose a topic…
                                </option>
                                {topics.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Button type="submit" variant="outline">
                              Tag
                            </Button>
                          </form>
                        )}

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {lesson.resources.map((r) => (
                            <span key={r.id} className={ui.roleTag}>
                              {r.assetId ? (
                                <a href={`/assets/${r.assetId}/download`} target="_blank" rel="noreferrer">
                                  {r.title} ({r.type})
                                </a>
                              ) : (
                                <>
                                  {r.title} ({r.type})
                                </>
                              )}
                              <form action={removeResourceAction} style={{ display: "inline" }}>
                                <input type="hidden" name="courseId" value={courseId} />
                                <input type="hidden" name="resourceId" value={r.id} />
                                <button type="submit" style={{ marginLeft: 6, cursor: "pointer" }}>
                                  ×
                                </button>
                              </form>
                            </span>
                          ))}
                        </div>
                        <Disclosure label="Add resource (link)">
                          <form action={addResourceAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", width: "100%", flexWrap: "wrap", gridColumn: "1 / -1" }}>
                            <input type="hidden" name="courseId" value={courseId} />
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <Field label="Title">
                              <Input name="title" placeholder="Reading guide" required />
                            </Field>
                            <Field label="URL" className={ui.fieldWide}>
                              <Input name="url" type="url" placeholder="https://example.com/resource" required />
                            </Field>
                            <Field label="Type">
                              <Select name="type" defaultValue="link">
                                <option value="link">Link</option>
                                <option value="document">Document</option>
                                <option value="video">Video</option>
                              </Select>
                            </Field>
                            <Button type="submit" variant="secondary">
                              Add
                            </Button>
                          </form>
                        </Disclosure>
                        <Disclosure label="Upload file">
                          <form action={uploadResourceFileAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", width: "100%", flexWrap: "wrap", gridColumn: "1 / -1" }}>
                            <input type="hidden" name="courseId" value={courseId} />
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <Field label="Title">
                              <Input name="title" placeholder="Lecture slides" required />
                            </Field>
                            <Field label="File" className={ui.fieldWide}>
                              <input type="file" name="file" required />
                            </Field>
                            <Field label="Type">
                              <Select name="type" defaultValue="document">
                                <option value="document">Document</option>
                                <option value="video">Video</option>
                              </Select>
                            </Field>
                            <Button type="submit" variant="secondary">
                              Upload
                            </Button>
                          </form>
                        </Disclosure>
                      </Card>
                    ))
                  )}

                  <Disclosure label="New lesson">
                    <form action={createLessonAction} style={{ display: "grid", gap: "10px", width: "100%", gridColumn: "1 / -1" }}>
                      <input type="hidden" name="courseId" value={courseId} />
                      <input type="hidden" name="moduleId" value={module.id} />
                      <Field label="Title" className={ui.fieldWide}>
                        <Input name="title" placeholder="e.g. Fractions basics" required />
                      </Field>
                      <Field label="Content" className={ui.fieldWide}>
                        <textarea name="content" required rows={4} className={ui.input} placeholder="Lesson body" />
                      </Field>
                      <div className={ui.disclosureActions}>
                        <Button type="submit" variant="primary">
                          Create lesson
                        </Button>
                      </div>
                    </form>
                  </Disclosure>
                </div>
              </Card>
            ))}
          </div>
        )}

        <Disclosure label="New module">
          <form action={createModuleAction} style={{ display: "contents" }}>
            <input type="hidden" name="courseId" value={courseId} />
            <Field label="Title" className={ui.fieldWide}>
              <Input name="title" placeholder="e.g. Module 1: Introduction" required />
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Create module
              </Button>
            </div>
          </form>
        </Disclosure>
      </section>

      <section>
        <SectionHeader title="Assessments" count={0} />
        <Banner>
          Assessment authoring is not available yet — pending Session 07's Assessment/Question/Attempt contract. This
          is the wired entry point (see the "Assessments" nav item and docs/TEACHER.md); no placeholder assessment
          engine has been built here per CLAUDE_BUILD_RULES.md §2.
        </Banner>
      </section>

      <section>
        <SectionHeader title="Cohort messaging" count={0} />
        <Banner>
          Teacher → student/cohort messaging is not available yet — pending Session 09's Conversation/Message
          contract. See the "Messages" nav item and docs/TEACHER.md for the exact contract this screen expects to
          consume once it exists.
        </Banner>
      </section>
    </div>
  );
}
