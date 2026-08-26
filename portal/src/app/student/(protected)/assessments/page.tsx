import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BlockedFeature } from "../BlockedFeature";

export default async function AssessmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <BlockedFeature
      title="Assignments & Assessments"
      ownerSession="Session 07 (Assessment)"
      contract={`Expected contract (see sessions/07-assessment.md):
  Question / Assessment / Attempt / Answer / Result entities under Education Core.
  Workflow: Teacher creates -> Draft -> Publish -> Assign -> Student Attempt -> Submit -> Grade -> Results.
  This page will call a student-facing "listAssignedAssessments(actor)" /
  "startAttempt(assessmentId, actor)" contract once it exists — the same
  shape src/lib/courses.ts's listMyEnrollments()/assertActiveEnrollment()
  already establish for Education Core. Events already typed and waiting:
  AssessmentSubmitted, AssessmentGraded (src/lib/events.ts).`}
    />
  );
}
