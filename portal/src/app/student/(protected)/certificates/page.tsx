import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { BlockedFeature } from "../BlockedFeature";

export default async function CertificatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const flagEnabled = await isFeatureEnabled(FEATURE_FLAGS.CERTIFICATES);

  return (
    <BlockedFeature
      title="Certificates"
      ownerSession="Session 14 (Certificates)"
      contract={`Expected contract (see sessions/14-certificates.md):
  Certificate entity — issuance driven by defined completion criteria (via
  Session 08's Progress model), not a UI button. "student certificate view"
  is explicitly Session 14's own scope; this entry point will call a
  "listMyCertificates(actor)" contract, self-scoped like every other
  listMy*() function here, once Certificate exists.

  Feature flag "certificates" (src/lib/feature-flags.ts) already exists
  and currently reads: ${flagEnabled ? "ENABLED" : "disabled"}. It gates
  nothing here yet since there's no Certificate table to show — Session 14
  should check it before rendering issued certificates once it lands.`}
    />
  );
}
