import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Banner, Button, Card, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { requestOwnPasswordResetAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  reset_unavailable: "Could not generate a reset link right now — try again shortly.",
};

export default async function StudentProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; resetLinkGenerated?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const query = await searchParams;

  let resetLink: string | null = null;
  if (query.resetLinkGenerated === "1") {
    const store = await cookies();
    resetLink = store.get("own_reset_link")?.value ?? null;
  }

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: "560px" }}>
      <SectionHeader title="Profile" count={0} />

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}
      {resetLink && (
        <Banner variant="success">
          Reset link generated (expires in 1 hour, single use):
          <div className={ui.mono} style={{ marginTop: 6, wordBreak: "break-all" }}>
            {resetLink}
          </div>
        </Banner>
      )}
      {query.resetLinkGenerated === "1" && !resetLink && (
        <Banner>The reset link already expired from view (shown once, for 60 seconds). Request a new one below.</Banner>
      )}

      <Card style={{ padding: "20px", display: "grid", gap: "10px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>{user.name ?? "Student"}</div>
          <div className={ui.mono}>{user.email}</div>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {user.roles.map((r) => (
            <span key={r} className={ui.roleTag}>
              {r}
            </span>
          ))}
        </div>
      </Card>

      <Card style={{ padding: "20px", display: "grid", gap: "10px" }}>
        <div style={{ fontWeight: 700 }}>Password</div>
        <p className={ui.mono}>
          No email delivery is configured yet, so the one-time link is shown here directly after you request it.
        </p>
        <form action={requestOwnPasswordResetAction}>
          <Button type="submit" variant="secondary">
            Send myself a password reset link
          </Button>
        </form>
      </Card>
    </div>
  );
}
