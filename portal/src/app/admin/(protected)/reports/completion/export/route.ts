import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authz";
import { getAdminCompletionReport, toCsv, type CourseCompletionRow } from "@/lib/reporting";
import { StepUpRequiredError, requireStepUp } from "@/lib/mfa";

/** Route Handlers aren't wrapped by their segment's layout guard — re-check auth here (same convention as Session 13's asset downloads). */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || (!session.user.isSuperAdmin && !hasPermission(session.user, PERMISSIONS.COURSES_MANAGE))) {
    return new Response("Not authorized", { status: 403 });
  }

  const url = new URL(req.url);

  // MFA & Account Security (Session 20) — "export sensitive data" is on
  // this session's explicit step-up list; a CSV download is a GET, so
  // there's no form to gate inline — bounce to the step-up challenge with
  // this exact URL as returnTo, same pattern as onboarding-actions.ts's
  // run() helper uses for Server Actions.
  try {
    await requireStepUp(session.user);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      // Hardcoded, not derived from req.url/url.pathname — middleware
      // already rewrote this request to /admin/reports/... internally
      // (src/middleware.ts), so the browser-facing path (what returnTo
      // must be, for the redirect the browser actually follows) is this
      // route's own known, portal-relative location, same "relative to
      // this subdomain" convention the login pages document.
      return Response.redirect(
        new URL(`/step-up?returnTo=${encodeURIComponent(`/reports/completion/export${url.search}`)}`, url),
        302
      );
    }
    throw err;
  }

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
