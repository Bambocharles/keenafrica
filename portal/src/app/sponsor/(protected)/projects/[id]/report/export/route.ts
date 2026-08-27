import { auth } from "@/lib/auth";
import { canAccessSponsorPortal, AuthorizationError } from "@/lib/authz";
import { getMilestoneReport, toCsv, type MilestoneReportRow } from "@/lib/reporting";

/** Route Handlers aren't wrapped by their segment's layout guard — re-check auth here (same convention as Session 13's asset downloads). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canAccessSponsorPortal(session.user)) {
    return new Response("Not authorized", { status: 403 });
  }

  const { id: projectId } = await params;

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
