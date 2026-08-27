import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { getCertificateById } from "@/lib/certificates";
import { revokeCertificateAction } from "../actions";
import { Banner, Button, Card, Field, SectionHeader, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have permission to revoke certificates (requires certificates.manage).",
  revoke_failed: "Could not revoke that certificate.",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

export default async function AdminCertificateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!user.isSuperAdmin && !hasPermission(user, PERMISSIONS.CERTIFICATES_MANAGE)) {
    return <Banner>You do not have permission to view certificates (requires certificates.manage).</Banner>;
  }

  const { id } = await params;
  const errorParams = await searchParams;
  const certificate = await getCertificateById(id, user);
  if (!certificate) return <Banner>Certificate not found.</Banner>;

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "620px" }}>
      <a href="/certificates" className={ui.linkMono}>
        ← Certificates
      </a>

      {errorParams.error && <Banner>{ERROR_MESSAGES[errorParams.error] ?? "Something went wrong."}</Banner>}

      <section>
        <SectionHeader title={certificate.certificateNumber} count={0} />
        <Card style={{ padding: "16px", display: "grid", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{certificate.studentNameSnapshot}</strong>
            <StatusBadge status={certificate.status} />
          </div>
          <div>{certificate.courseTitleSnapshot}</div>
          <div className={ui.mono}>Completed {formatDate(certificate.completedAt)}</div>
          <div className={ui.mono}>Issued {formatDate(certificate.issuedAt)}</div>
          <div className={ui.mono}>Template version {certificate.templateVersion}</div>
          {certificate.status === "revoked" && (
            <div className={ui.mono}>
              Revoked {certificate.revokedAt ? formatDate(certificate.revokedAt) : ""}
              {certificate.revokedReason ? ` — ${certificate.revokedReason}` : ""}
            </div>
          )}
          {certificate.downloadAssetId && (
            <a className={ui.linkMono} href={`/assets/${certificate.downloadAssetId}/download`}>
              Download file →
            </a>
          )}
        </Card>
      </section>

      {certificate.status === "active" && hasPermission(user, PERMISSIONS.CERTIFICATES_MANAGE) && (
        <section>
          <SectionHeader title="Revoke certificate" count={0} />
          <Card style={{ padding: "16px" }}>
            <form action={revokeCertificateAction} style={{ display: "grid", gap: "10px" }}>
              <input type="hidden" name="id" value={certificate.id} />
              <Field label="Reason">
                <textarea name="reason" className={ui.input} rows={3} placeholder="Reason for revocation" />
              </Field>
              <Button type="submit" variant="danger">
                Revoke
              </Button>
            </form>
          </Card>
        </section>
      )}
    </div>
  );
}
