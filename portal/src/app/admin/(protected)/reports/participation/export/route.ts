import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authz";
import { getAdminParticipationReport, toCsv, type CourseParticipationRow } from "@/lib/reporting";

/** Route Handlers aren't wrapped by their segment's layout guard — re-check auth here (same convention as Session 13's asset downloads). */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || (!session.user.isSuperAdmin && !hasPermission(session.user, PERMISSIONS.COURSES_MANAGE))) {
    return new Response("Not authorized", { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined;
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined;

  const report = await getAdminParticipationReport(session.user, { from, to });
  const csv = toCsv<CourseParticipationRow>(report.courses, [
    { key: "courseId", header: "Course ID" },
    { key: "courseTitle", header: "Course" },
    { key: "lessonsCompleted", header: "Lessons completed" },
    { key: "attemptsSubmitted", header: "Attempts submitted" },
    { key: "activeStudents", header: "Active students" },
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="participation-report.csv"`,
    },
  });
}
