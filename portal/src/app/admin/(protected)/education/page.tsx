import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listCourses } from "@/lib/courses";
import { AuthorizationError, PERMISSIONS, hasPermission } from "@/lib/authz";
import { createCourseAction } from "./actions";
import { Banner, Button, Disclosure, EmptyState, Field, Input, Select, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "A title is required.",
  not_authorized: "You do not have permission to create a course.",
  action_failed: "That action could not be completed.",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function EducationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!hasPermission(user, PERMISSIONS.COURSES_MANAGE)) {
    return <Banner>You do not have permission to view courses (requires courses.manage).</Banner>;
  }

  const params = await searchParams;
  const status = params.status === "draft" || params.status === "published" || params.status === "archived" ? params.status : undefined;

  let result;
  try {
    result = await listCourses({ status, pageSize: 50 }, user);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>You do not have permission to view courses.</Banner>;
    throw err;
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {params.error && <Banner>{ERROR_MESSAGES[params.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title="Courses" count={result.total} />

        <form method="get" className={ui.filterBar}>
          <Field label="Status">
            <Select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        {result.courses.length === 0 ? (
          <EmptyState title="No courses yet" hint="Create a course below to get started." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Cohorts</th>
                <th>Modules</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {result.courses.map((c) => (
                <tr key={c.id}>
                  <td className={ui.nameCell}>{c.title}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>{c._count.cohorts}</td>
                  <td>{c._count.modules}</td>
                  <td className={ui.mono}>{formatDate(c.createdAt)}</td>
                  <td>
                    <a className={ui.linkMono} href={`/education/${c.id}`}>
                      Manage →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {hasPermission(user, PERMISSIONS.COURSES_CREATE) && (
          <Disclosure label="New course">
            <form action={createCourseAction} style={{ display: "contents" }}>
              <Field label="Title" className={ui.fieldWide}>
                <Input name="title" placeholder="e.g. UTME Mathematics" required />
              </Field>
              <Field label="Description" className={ui.fieldWide}>
                <Input name="description" placeholder="Short summary" />
              </Field>
              <div className={ui.disclosureActions}>
                <Button type="submit" variant="primary">
                  Create course
                </Button>
              </div>
            </form>
          </Disclosure>
        )}
      </section>
    </div>
  );
}
