import { auth } from "@/lib/auth";
import { canAccessSponsorPortal, AuthorizationError } from "@/lib/authz";
import { getMilestoneReport, toCsv, type MilestoneReportRow } from "@/lib/reporting";
import { StepUpRequiredError, requireStepUp } from "@/lib/mfa";

/** Route Handlers aren't wrapped by their segment's layout guard — re-check auth here (same convention as Session 13's asset downloads). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canAccessSponsorPortal(session.user)) {
    return new Response("Not authorized", { status: 403 });
  }

  const { id: projectId } = await params;

  // MFA & Account Security (Session 20) — see the matching comment on the
  // admin console's report export routes.
  try {
    await requireStepUp(session.user);
  } catch (err) {
    if (err instanceof StepUpRequiredError) {
      // Session 28 (QA Sponsor) — found live: in production, req.url's host
      // resolves to the pod's internal bind address (0.0.0.0:3000, the same
      // Kubernetes-HOSTNAME-fallback class of bug server-entrypoint.js
      // already documents/works around for Auth.js's own redirects), making
      // this redirect target unreachable. Route Handlers aren't covered by
      // that workaround, so override just the host/port from the request's
      // own Host header (already trusted the same way by src/middleware.ts's
      // subdomain routing) rather than trusting req.url's host wholesale.
      const target = new URL(`/step-up?returnTo=${encodeURIComponent(`/projects/${projectId}/report/export`)}`, req.url);
      const forwardedHost = req.headers.get("host");
      if (forwardedHost) target.host = forwardedHost;
      return Response.redirect(target, 302);
    }
    throw err;
  }

  let report;
  try {
    report = await getMilestoneReport(projectId, session.user);
  } catch (err) {
    if (err instanceof AuthorizationError) return new Response("Not authorized", { status: 403 });
    throw err;
  }

  const csv = toCsv<MilestoneReportRow>(report.rows, [
    { key: "id", header: "Milestone ID" },
    { key: "title", header: "Title" },
    { key: "status", header: "Status" },
    { key: "targetDate", header: "Target date" },
    { key: "achievedAt", header: "Achieved at" },
    { key: "overdue", header: "Overdue" },
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="project-milestone-report.csv"`,
    },
  });
}
