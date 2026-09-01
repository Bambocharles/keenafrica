import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getNotificationPreference } from "@/lib/notifications";
import { getOwnVerification } from "@/lib/verification";
import {
  connectLinkedInAction,
  requestOwnPasswordResetAction,
  updateArticleUnpublishedPreferenceAction,
} from "./actions";
import { Banner, Button, Card, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  reset_unavailable: "Could not generate a reset link right now — try again shortly.",
  linkedin_no_email: "That LinkedIn account has no email address on file — connect a different one.",
  linkedin_email_exists: "That LinkedIn account's email is already used by a different Keen Africans account.",
  linkedin_no_account: "LinkedIn sign-in isn't available outside the Connect LinkedIn flow.",
  linkedin_conflicting_link: "That LinkedIn account is already connected to a different Keen Africans account.",
  linkedin_account_suspended: "That account can't be used right now.",
};

const VERIFICATION_LABELS: Record<string, string> = {
  linkedin_connected: "LinkedIn connected — pending review",
  verified: "Verified Keen African",
  rejected: "Not approved",
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
  searchParams: Promise<{ error?: string; resetLinkGenerated?: string; linkedinConnected?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const { error, resetLinkGenerated, linkedinConnected } = await searchParams;

  let resetLink: string | null = null;
  if (resetLinkGenerated === "1") {
    const store = await cookies();
    resetLink = store.get("own_reset_link")?.value ?? null;
  }

  const [articleUnpublishedByAdminEnabled, verification] = await Promise.all([
    getNotificationPreference(user, "article_unpublished_by_admin"),
    getOwnVerification(user),
  ]);

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
      {linkedinConnected === "1" && (
        <Banner variant="success">
          LinkedIn connected. Your account is now pending review — you&apos;ll see it here once a reviewer decides.
        </Banner>
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

      <Card style={{ padding: "20px", display: "grid", gap: "12px", maxWidth: 420 }}>
        <SectionHeader title="Identity verification" count={0} />
        <p className={ui.subCell} style={{ margin: 0 }}>
          Connecting LinkedIn proves you control a real LinkedIn account with a matching name and photo — it does not
          submit any ID or document. A reviewer then checks the connected profile before granting the{" "}
          <strong>Verified Keen African</strong> badge.
        </p>
        {!verification ? (
          <form action={connectLinkedInAction}>
            <Button type="submit" variant="primary">
              Connect LinkedIn
            </Button>
          </form>
        ) : (
          <>
            <div className={ui.nameCell}>{VERIFICATION_LABELS[verification.status] ?? verification.status}</div>
            {verification.linkedinName && (
              <div className={ui.subCell}>
                Connected as {verification.linkedinName}
                {verification.connectedAt && ` on ${new Date(verification.connectedAt).toLocaleDateString()}`}.
              </div>
            )}
            {verification.status === "rejected" && verification.reviewNote && (
              <Banner>Reviewer note: {verification.reviewNote}</Banner>
            )}
            {verification.status !== "verified" && (
              <form action={connectLinkedInAction}>
                <Button type="submit" variant="outline">
                  {verification.status === "rejected" ? "Reconnect LinkedIn" : "Reconnect a different LinkedIn account"}
                </Button>
              </form>
            )}
          </>
        )}
      </Card>

      <Card style={{ padding: "20px", display: "grid", gap: "10px", maxWidth: 420 }}>
        <SectionHeader title="Notifications" count={0} />
        <form action={updateArticleUnpublishedPreferenceAction} style={{ display: "grid", gap: "10px" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: 13.5 }}>
            <input
              type="checkbox"
              name="articleUnpublishedByAdmin"
              defaultChecked={articleUnpublishedByAdminEnabled}
              style={{ marginTop: "2px" }}
            />
            Notify me if an admin unpublishes one of my articles
          </label>
          <Button type="submit" variant="outline" style={{ justifySelf: "start" }}>
            Save
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
