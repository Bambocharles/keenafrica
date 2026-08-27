import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authz";
import { getAdminCompletionReport, toCsv, type CourseCompletionRow } from "@/lib/reporting";

/** Route Handlers aren't wrapped by their segment's layout guard — re-check auth here (same convention as Session 13's asset downloads). */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || (!session.user.isSuperAdmin && !hasPermission(session.user, PERMISSIONS.COURSES_MANAGE))) {
    return new Response("Not authorized", { status: 403 });
  }

  const url = new URL(req.url);
  const courseId = url.searchParams.get("courseId")?.trim() || undefined;
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined;
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined;

  const report = await getAdminCompletionReport(session.user, { courseId, from, to });
  const csv = toCsv<CourseCompletionRow>(report.courses, [
    { key: "courseId", header: "Course ID" },
    { key: "courseTitle", header: "Course" },
    { key: "enrollments", header: "Enrollments" },
    { key: "completed", header: "Completed" },
    { key: "active", header: "Active" },
    { key: "withdrawn", header: "Withdrawn" },
    { key: "completionRatePercent", header: "Completion rate %" },
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="completion-report.csv"`,
    },
  });
}
