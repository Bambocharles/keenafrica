import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requestOwnPasswordResetAction } from "./actions";
import { Banner, Button, Card, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  reset_unavailable: "Could not generate a reset link right now — try again shortly.",
};

/**
 * Private account settings — split from /profile (public) per this
 * session's own explicit rule. Today this only holds identity + the
 * existing self-service password reset (moved from the dashboard's old
 * embedded "Account" card); email change, MFA enrollment, and other
 * security actions are Session 37's territory — this page is deliberately
 * left open for that session to extend, not built as a finished settings
 * page.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; resetLinkGenerated?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const { error, resetLinkGenerated } = await searchParams;

  let resetLink: string | null = null;
  if (resetLinkGenerated === "1") {
    const store = await cookies();
    resetLink = store.get("own_reset_link")?.value ?? null;
  }

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader title="Account" count={0} />

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}
      {resetLink && (
        <Banner variant="success">
          Reset link generated (expires in 1 hour, single use):
          <div className={ui.mono} style={{ marginTop: 6, wordBreak: "break-all" }}>
            {resetLink}
          </div>
        </Banner>
      )}
      {resetLinkGenerated === "1" && !resetLink && (
        <Banner>The reset link already expired from view (shown once, for 60 seconds). Request a new one below.</Banner>
      )}

      <Card style={{ padding: "20px", display: "grid", gap: "10px", maxWidth: 420 }}>
        <div>
          <div className={ui.nameCell}>{user.name ?? "Keen African"}</div>
          <div className={ui.subCell}>{user.email}</div>
        </div>
        <form action={requestOwnPasswordResetAction}>
          <Button type="submit" variant="outline">
            Send myself a password reset link
          </Button>
        </form>
      </Card>

      <Card style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div className={ui.subCell}>
          Change your password or email, set up two-factor authentication, or manage your active sessions.
        </div>
        <a href="/security" style={{ textDecoration: "none" }}>
          <Button type="button" variant="outline">
            Go to Security
          </Button>
        </a>
      </Card>

      <Card style={{ padding: "20px", display: "grid", gap: "10px", maxWidth: 420, borderColor: "var(--danger-ink)" }}>
        <SectionHeader title="Danger zone" count={0} />
        <p className={ui.subCell} style={{ margin: 0 }}>
          Deleting your account anonymizes it — your name is replaced and your login is permanently disabled — but
          any articles you&apos;ve published stay live on Keen Africans under that anonymized name. This cannot be
          undone.
        </p>
        <div>
          <a href="/account/delete" style={{ textDecoration: "none" }}>
            <Button type="button" variant="danger">
              Delete my account
            </Button>
          </a>
        </div>
      </Card>
    </div>
  );
}
