import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { listMyCoursesForWorkspace } from "@/lib/courses";
import { listMyOrganizations } from "@/lib/organizations";
import { Banner, Button, Disclosure, EmptyState, Field, Input, SectionHeader, Select, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { createOrganizationCourseAction } from "./actions";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "A title and an organization are both required.",
  not_authorized: "You can only create a course for an organization you're an active member of.",
  action_failed: "Couldn't create that course. Please try again.",
};

export default async function TeacherCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;
  const params = await searchParams;

  const courses = await listMyCoursesForWorkspace(actor);

  // Session 45: a teacher may create an ORGANIZATION-scoped course for an
  // organization they are an ACTIVE member of — never a platform-wide one,
  // and never someone else's organization. This list is UI convenience
  // only; createCourse() and courses_write's RLS policy each re-check
  // membership server-side, so a crafted POST naming another organization
  // is refused regardless of what this renders.
  const canCreateOrgCourse = hasPermission(actor, PERMISSIONS.COURSES_CREATE_ORG);
  const myOrganizations = canCreateOrgCourse
    ? (await listMyOrganizations(actor)).filter((m) => m.status === "active")
    : [];

  // `isTaught` (from listMyCoursesForWorkspace) is false for a course the
  // teacher created but is not yet assigned to teach: with no
  // cohort_teachers row, every ownership-scoped page behind "Manage"
  // (getCourseById, module/lesson authoring) would correctly refuse them.
  // Rather than render a link that 403s, say what's actually true. Cohort
  // creation and teacher assignment remain courses.manage (admin) actions —
  // see this session's handoff.

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="My courses" count={courses.length} />

      {params.error && <Banner>{ERROR_MESSAGES[params.error] ?? "Something went wrong."}</Banner>}
      {params.created && <Banner variant="success">Course created. An admin needs to add a cohort before you can teach it.</Banner>}

      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          hint={
            canCreateOrgCourse && myOrganizations.length > 0
              ? "You'll see a course here once an admin assigns you to one of its cohorts — or create one for your organization below."
              : "You'll see a course here once an admin assigns you to one of its cohorts."
          }
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
                  {c.isTaught ? (
                    <a className={ui.linkMono} href={`/courses/${c.id}`}>
                      Manage →
                    </a>
                  ) : (
                    <span className={ui.mono}>Awaiting cohort setup</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canCreateOrgCourse && myOrganizations.length > 0 && (
        <Disclosure label="New organization course">
          <form action={createOrganizationCourseAction} style={{ display: "contents" }}>
            <Field label="Title" className={ui.fieldWide}>
              <Input name="title" placeholder="e.g. UTME Mathematics" required />
            </Field>
            <Field label="Description" className={ui.fieldWide}>
              <Input name="description" placeholder="Short summary" />
            </Field>
            <Field label="Organization" className={ui.fieldWide}>
              <Select name="organizationId" required defaultValue={myOrganizations[0].organizationId}>
                {myOrganizations.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organization.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className={ui.disclosureActions}>
              <Button type="submit" variant="primary">
                Create course
              </Button>
            </div>
          </form>
        </Disclosure>
      )}
    </div>
  );
}
