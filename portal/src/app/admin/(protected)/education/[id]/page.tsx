import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCourseById, listCohortsForCourse, listEnrollmentsForCohort } from "@/lib/courses";
import { AuthorizationError, PERMISSIONS, hasPermission } from "@/lib/authz";
import {
  archiveCourseAction,
  assignTeacherAction,
  createCohortAction,
  enrollStudentAction,
  publishCourseAction,
  removeTeacherAction,
  updateCourseAction,
  withdrawEnrollmentAction,
} from "./actions";
import { Banner, Button, Card, Disclosure, EmptyState, Field, Input, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "That field is required.",
  not_authorized: "You do not have permission to perform that action.",
  action_failed: "That action could not be completed.",
  user_not_found: "No user with that email address was found.",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const { id } = await params;
  const query = await searchParams;

  let course;
  try {
    course = await getCourseById(id, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>You do not have permission to view this course.</Banner>;
    throw err;
  }
  if (!course) return <Banner>Course not found.</Banner>;

  const cohorts = await listCohortsForCourse(id, actor);
  const enrollmentsByCohort = await Promise.all(
    cohorts.map(async (c) => ({ cohortId: c.id, enrollments: await listEnrollmentsForCohort(c.id, actor) }))
  );

  const canManage = hasPermission(actor, PERMISSIONS.COURSES_MANAGE);
  const canPublish = hasPermission(actor, PERMISSIONS.COURSES_PUBLISH);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/education" className={ui.linkMono}>
        ← All courses
      </a>

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title={course.title} count={0} />
        <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <StatusBadge status={course.status} />
            <span className={ui.mono}>Created {formatDate(course.createdAt)}</span>
          </div>
          {course.description && <p>{course.description}</p>}

          {canManage && (
            <form action={updateCourseAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
              <input type="hidden" name="courseId" value={course.id} />
              <Field label="Title">
                <Input name="title" defaultValue={course.title} required />
              </Field>
              <Field label="Description" className={ui.fieldWide}>
                <Input name="description" defaultValue={course.description} />
              </Field>
              <Button type="submit" variant="secondary">
                Save
              </Button>
            </form>
          )}

          {canPublish && (
            <div style={{ display: "flex", gap: "8px" }}>
              {course.status !== "published" && (
                <form action={publishCourseAction}>
                  <input type="hidden" name="courseId" value={course.id} />
                  <Button type="submit" variant="primary">
                    Publish course
                  </Button>
                </form>
              )}
              {course.status !== "archived" && (
                <form action={archiveCourseAction}>
                  <input type="hidden" name="courseId" value={course.id} />
                  <Button type="submit" variant="danger">
                    Archive course
                  </Button>
                </form>
              )}
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader title="Cohorts" count={cohorts.length} />

        {cohorts.length === 0 ? (
          <EmptyState title="No cohorts yet" hint="Create a cohort below, then assign a teacher and enroll students." />
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {cohorts.map((cohort) => {
              const enrollments = enrollmentsByCohort.find((e) => e.cohortId === cohort.id)?.enrollments ?? [];
              return (
                <Card key={cohort.id} style={{ padding: "16px", display: "grid", gap: "10px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{cohort.name}</strong>
                    <StatusBadge status={cohort.status} />
                    <span className={ui.mono}>{cohort.teachers.length} teacher(s)</span>
                    <span className={ui.mono}>{cohort._count.enrollments} enrolled</span>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {cohort.teachers.map((ct) => (
                      <span key={ct.teacherUserId} className={ui.roleTag}>
                        {ct.teacher.name}
                        {canManage && (
                          <form action={removeTeacherAction} style={{ display: "inline" }}>
                            <input type="hidden" name="courseId" value={course.id} />
                            <input type="hidden" name="cohortId" value={cohort.id} />
                            <input type="hidden" name="teacherUserId" value={ct.teacherUserId} />
                            <button type="submit" style={{ marginLeft: 6, cursor: "pointer" }}>
                              ×
                            </button>
                          </form>
                        )}
                      </span>
                    ))}
                  </div>

                  {canManage && (
                    <Disclosure label="Manage teachers & students">
                      <div style={{ display: "grid", gap: "16px", width: "100%" }}>
                        <form action={assignTeacherAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                          <input type="hidden" name="courseId" value={course.id} />
                          <input type="hidden" name="cohortId" value={cohort.id} />
                          <Field label="Assign teacher by email">
                            <Input name="teacherEmail" type="email" placeholder="teacher@example.com" required />
                          </Field>
                          <Button type="submit" variant="secondary">
                            Assign
                          </Button>
                        </form>

                        <form action={enrollStudentAction} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                          <input type="hidden" name="courseId" value={course.id} />
                          <input type="hidden" name="cohortId" value={cohort.id} />
                          <Field label="Enroll student by email">
                            <Input name="studentEmail" type="email" placeholder="student@example.com" required />
                          </Field>
                          <Button type="submit" variant="secondary">
                            Enroll
                          </Button>
                        </form>

                        {enrollments.length > 0 && (
                          <Table>
                            <thead>
                              <tr>
                                <th>Student</th>
                                <th>Status</th>
                                <th>Enrolled</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {enrollments.map((e) => (
                                <tr key={e.id}>
                                  <td className={ui.nameCell}>
                                    {e.student.name}
                                    <span className={ui.subCell}>{e.student.email}</span>
                                  </td>
                                  <td>
                                    <StatusBadge status={e.status} />
                                  </td>
                                  <td className={ui.mono}>{formatDate(e.enrolledAt)}</td>
                                  <td>
                                    {e.status === "active" && (
                                      <form action={withdrawEnrollmentAction}>
                                        <input type="hidden" name="courseId" value={course.id} />
                                        <input type="hidden" name="enrollmentId" value={e.id} />
                                        <Button type="submit" variant="outline">
                                          Withdraw
                                        </Button>
                                      </form>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        )}
                      </div>
                    </Disclosure>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {canManage && (
          <Disclosure label="New cohort">
            <form action={createCohortAction} style={{ display: "contents" }}>
              <input type="hidden" name="courseId" value={course.id} />
              <Field label="Cohort name" className={ui.fieldWide}>
                <Input name="name" placeholder="e.g. 2026 Cohort A" required />
              </Field>
              <div className={ui.disclosureActions}>
                <Button type="submit" variant="primary">
                  Create cohort
                </Button>
              </div>
            </form>
          </Disclosure>
        )}
      </section>

      <Banner>
        Module/lesson authoring and publishing is a TEACHER (via cohort assignment) capability, exercised through
        src/lib/content.ts — not built into this admin screen. See Session 05 (Teacher) for the dedicated authoring UI.
      </Banner>
    </div>
  );
}
