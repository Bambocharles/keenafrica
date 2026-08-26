import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BlockedFeature } from "../BlockedFeature";

export default async function ResultsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <BlockedFeature
      title="Results"
      ownerSession="Session 07 (Assessment)"
      contract={`Expected contract (see sessions/07-assessment.md):
  Attempt/Result entities — "historical attempts are preserved," "results
  are visible according to permissions." This page will call a student-
  facing "listMyResults(actor)" contract, self-scoped the same way
  listMyEnrollments()/listMyNotes() are here, once Attempt/Result exist.`}
    />
  );
}
