import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authz";
import { getAdminAssessmentOutcomesReport, toCsv, type AssessmentOutcomeRow } from "@/lib/reporting";

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

  const report = await getAdminAssessmentOutcomesReport(session.user, { courseId, from, to });
  const csv = toCsv<AssessmentOutcomeRow>(report.assessments, [
    { key: "assessmentId", header: "Assessment ID" },
    { key: "assessmentTitle", header: "Assessment" },
    { key: "courseTitle", header: "Course" },
    { key: "attempts", header: "Attempts" },
    { key: "gradedAttempts", header: "Graded" },
    { key: "avgScorePercent", header: "Avg score %" },
    { key: "passRatePercent", header: "Pass rate %" },
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assessment-outcomes-report.csv"`,
    },
  });
}
