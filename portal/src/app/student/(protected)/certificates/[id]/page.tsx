import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { getCertificateById } from "@/lib/certificates";
import { Banner, Button, Card, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export default async function StudentCertificateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const certificatesEnabled = await isFeatureEnabled(FEATURE_FLAGS.CERTIFICATES);
  if (!certificatesEnabled) {
    return <Banner>Certificates are built but not yet turned on for your account.</Banner>;
  }

  const { id } = await params;
  const certificate = await getCertificateById(id, actor);
  // certificates_select's RLS policy already restricts this to self/
  // teacher/certificates.manage/super_admin — a plain student who isn't the
  // certificate's own owner gets null here (application-layer 404), the
  // same "hide, don't 403" shape src/app/student/(protected)/results uses.
  if (!certificate || certificate.studentUserId !== actor.id) {
    return <Banner>Certificate not found.</Banner>;
  }

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "680px" }}>
      <a href="/certificates" className={ui.linkMono}>
        ← Certificates
      </a>

      {certificate.status === "revoked" && (
        <Banner>
          This certificate was revoked on {formatDate(certificate.revokedAt!)}
          {certificate.revokedReason ? `: ${certificate.revokedReason}` : "."}
        </Banner>
      )}

      <Card style={{ padding: "32px", display: "grid", gap: "16px", textAlign: "center", border: "2px solid var(--border)" }}>
        <div className={ui.mono}>Keen Africa — Certificate of Completion</div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <StatusBadge status={certificate.status} />
        </div>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--ink-soft)" }}>This certifies that</p>
        <h1 style={{ margin: 0, fontSize: "26px" }}>{certificate.studentNameSnapshot}</h1>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--ink-soft)" }}>has successfully completed</p>
        <h2 style={{ margin: 0, fontSize: "20px" }}>{certificate.courseTitleSnapshot}</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px", textAlign: "left" }}>
          <div>
            <div className={ui.mono}>Completed</div>
            <div>{formatDate(certificate.completedAt)}</div>
          </div>
          <div>
            <div className={ui.mono}>Issued</div>
            <div>{formatDate(certificate.issuedAt)}</div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", marginTop: "4px" }}>
          <div className={ui.mono}>Certificate number</div>
          <div className={ui.mono} style={{ fontSize: "15px", fontWeight: 700 }}>
            {certificate.certificateNumber}
          </div>
        </div>
      </Card>

      {certificate.downloadAssetId && (
        <a href={`/assets/${certificate.downloadAssetId}/download`}>
          <Button variant="secondary" type="button">
            Download certificate
          </Button>
        </a>
      )}
    </div>
  );
}
