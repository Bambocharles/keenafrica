import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listMyCertificates } from "@/lib/certificates";
import { Banner, Card, EmptyState, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function StudentCertificatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const certificatesEnabled = await isFeatureEnabled(FEATURE_FLAGS.CERTIFICATES);
  if (!certificatesEnabled) {
    return (
      <div style={{ display: "grid", gap: "16px" }}>
        <SectionHeader title="Certificates" count={0} />
        <Banner>
          Certificates are built but not yet turned on for your account — an administrator can enable the
          &quot;certificates&quot; feature flag from the admin console.
        </Banner>
      </div>
    );
  }

  const certificates = await listMyCertificates(actor);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Certificates" count={certificates.length} />

      {certificates.length === 0 ? (
        <EmptyState
          title="No certificates yet"
          hint="A certificate is issued automatically once you complete every published lesson in a course."
        />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {certificates.map((c) => (
            <a key={c.id} href={`/certificates/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <Card style={{ padding: "14px 16px", display: "grid", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong>{c.courseTitleSnapshot}</strong>
                  {c.status === "revoked" && <StatusBadge status="revoked" />}
                </div>
                <div className={ui.mono}>
                  Issued {formatDate(c.issuedAt)} · {c.certificateNumber}
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
