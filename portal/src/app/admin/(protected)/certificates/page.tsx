import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { listRecentCertificates, verifyCertificateByNumber } from "@/lib/certificates";
import { Banner, Button, Card, EmptyState, Field, Input, SectionHeader, StatusBadge, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function AdminCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  if (!user.isSuperAdmin && !hasPermission(user, PERMISSIONS.CERTIFICATES_MANAGE)) {
    return <Banner>You do not have permission to view certificates (requires certificates.manage).</Banner>;
  }

  const params = await searchParams;
  const number = params.number?.trim();
  const verified = number ? await verifyCertificateByNumber(number, user) : null;

  const recent = await listRecentCertificates(user);

  return (
    <div style={{ display: "grid", gap: "28px" }}>
      <section>
        <SectionHeader title="Certificates" count={recent.length} />
        <p className={ui.mono} style={{ margin: "4px 0 12px" }}>
          Issued automatically once a student meets Progress&apos;s course-completion criterion — see
          docs/CERTIFICATES.md. Verify authenticity by certificate number below.
        </p>

        <form method="get" className={ui.filterBar}>
          <Field label="Certificate number">
            <Input type="text" name="number" defaultValue={number ?? ""} placeholder="KA-2026-XXXXXXXXXXXX" />
          </Field>
          <Button type="submit" variant="secondary">
            Verify
          </Button>
        </form>

        {number && (
          <div style={{ marginTop: "12px" }}>
            {verified ? (
              <Card style={{ padding: "16px", display: "grid", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <strong>Valid certificate record</strong>
                  <StatusBadge status={verified.status} />
                </div>
                <div>
                  {verified.studentNameSnapshot} — {verified.courseTitleSnapshot}
                </div>
                <div className={ui.mono}>
                  Issued {formatDate(verified.issuedAt)} · {verified.certificateNumber}
                </div>
                <a className={ui.linkMono} href={`/certificates/${verified.id}`}>
                  View full record →
                </a>
              </Card>
            ) : (
              <Banner>No certificate found with that number.</Banner>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionHeader title="Recently issued" count={recent.length} />
        {recent.length === 0 ? (
          <EmptyState title="No certificates issued yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Course</th>
                <th>Certificate #</th>
                <th>Status</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <td className={ui.nameCell}>{c.studentNameSnapshot}</td>
                  <td>{c.courseTitleSnapshot}</td>
                  <td className={ui.mono}>
                    <a className={ui.linkMono} href={`/certificates/${c.id}`}>
                      {c.certificateNumber}
                    </a>
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className={ui.mono}>{formatDate(c.issuedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
