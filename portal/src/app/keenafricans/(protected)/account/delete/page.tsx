import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { deleteAccountAction } from "./actions";
import { Banner, Button, Card, Field, Input, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  confirmation_mismatch: 'Type "DELETE MY ACCOUNT" exactly (all caps) to confirm.',
  privileged_account:
    "This account holds a platform administrator role and can't be self-deleted here — ask another administrator to remove that role first, or handle deletion through the admin console.",
  action_failed: "Something went wrong. Try again.",
};

/**
 * Account & Security (Session 37) — the Danger Zone's actual confirmation
 * screen. States the site owner's anonymize-don't-delete policy here, at
 * the point of deletion (this session's explicit "Must NOT: skip stating
 * the deletion policy to the user at the point of deletion") — not only in
 * /terms. A typed confirmation phrase plus a required step-up proof
 * (enforced server-side by deleteAccountAction, not just this page's UI)
 * make this a deliberate, two-factor-confirmed action, never a single
 * accidental click.
 */
export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { error } = await searchParams;

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: 560 }}>
      <SectionHeader title="Delete my account" count={0} />

      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
        <div style={{ fontWeight: 700 }}>This is permanent. Here is exactly what happens.</div>
        <ul style={{ margin: 0, paddingLeft: "20px", display: "grid", gap: "8px", fontSize: 13.5 }}>
          <li>
            Your account is <strong>anonymized</strong>, not erased: your name is replaced with{" "}
            <strong>&ldquo;Former Keen African&rdquo;</strong>, your email and password are cleared, and your login
            is permanently disabled — including &ldquo;Continue with Google&rdquo;, if you use it.
          </li>
          <li>
            <strong>Any articles you&apos;ve published stay live</strong> on Keen Africans, attributed to &ldquo;Former
            Keen African&rdquo; instead of your name. We don&apos;t take down published work when an author leaves —
            drafts and archived articles are relabeled the same way, but stay exactly as visible (or not) as they are
            today.
          </li>
          <li>Your public profile page keeps working at the same address, now showing the anonymized name with no bio, photo, or links.</li>
          <li>Every device you&apos;re signed in on is signed out immediately.</li>
          <li>This cannot be undone by you — there is no self-service way to restore the account afterward.</li>
        </ul>
      </Card>

      <Card style={{ padding: "20px", display: "grid", gap: "14px" }}>
        <form action={deleteAccountAction} style={{ display: "grid", gap: "12px" }}>
          <Field label={`Type "DELETE MY ACCOUNT" to confirm`}>
            <Input name="confirmation" placeholder="DELETE MY ACCOUNT" autoComplete="off" required />
          </Field>
          <div>
            <Button type="submit" variant="danger">
              Permanently delete my account
            </Button>
          </div>
          <p className={ui.subCell} style={{ margin: 0 }}>
            You&apos;ll be asked to re-verify it&apos;s you (your password, an authenticator code, or a recovery
            code) before this takes effect.
          </p>
        </form>
      </Card>

      <a href="/account" className={ui.subCell}>
        ← Back to Account
      </a>
    </div>
  );
}
