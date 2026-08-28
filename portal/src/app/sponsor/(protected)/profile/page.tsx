import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOwnProfile } from "@/lib/users";
import { hasPermission, PERMISSIONS } from "@/lib/authz";
import { updateProfileAction, connectGoogleAction } from "./actions";
import { listOwnLinkedProviders } from "@/lib/oauth-identity";
import { Banner, Button, Card, Field, Input, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Name is required.",
  not_authorized: "You do not have permission to update this profile.",
  action_failed: "That action could not be completed.",
  // Session 19 (Federated Auth) — see src/lib/auth.ts's signIn callback,
  // which sends conflicting_link back to /profile specifically.
  google_conflicting_link: "That Google account is already connected to a different account.",
};

export default async function SponsorProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; linked?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const query = await searchParams;
  const linkedProviders = await listOwnLinkedProviders(session.user.id);

  // A fresh DB read, not session.user — see the teacher profile page's
  // identical comment: the JWT session's `name` claim is set once at login.
  const user = (await getOwnProfile(session.user)) ?? session.user;

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="Your profile" count={0} />

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}
      {query.success === "1" && !query.error && <Banner variant="success">Profile updated.</Banner>}
      {query.linked === "1" && !query.error && <Banner variant="success">Google account connected.</Banner>}

      <Card style={{ padding: "20px", display: "grid", gap: "14px", maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className={ui.mono}>{user.email}</span>
          <span className={ui.roleTag}>
            {hasPermission(session.user, PERMISSIONS.SPONSOR_USERS_MANAGE) ? "Sponsor admin" : "Sponsor user"}
          </span>
        </div>
        <form action={updateProfileAction} style={{ display: "grid", gap: "12px" }}>
          <Field label="Display name">
            <Input name="name" defaultValue={user.name ?? ""} required />
          </Field>
          <div>
            <Button type="submit" variant="primary">
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card style={{ padding: "20px", display: "grid", gap: "10px", maxWidth: 420 }}>
        <div style={{ fontWeight: 700 }}>Connected accounts</div>
        {linkedProviders.includes("google") ? (
          <p className={ui.mono}>Google — connected.</p>
        ) : (
          <>
            <p className={ui.mono}>Sign in faster next time by connecting your Google account.</p>
            <form action={connectGoogleAction}>
              <Button type="submit" variant="secondary">
                Connect Google
              </Button>
            </form>
          </>
        )}
      </Card>

      <Banner variant="success">
        Email changes and password resets are handled by an administrator (see the admin console's user directory) —
        not built here to avoid a parallel identity flow (see Session 02/03).
      </Banner>
    </div>
  );
}
