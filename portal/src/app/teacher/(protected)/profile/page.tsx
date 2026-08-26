import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOwnProfile } from "@/lib/users";
import { updateProfileAction } from "./actions";
import { Banner, Button, Card, Field, Input, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Name is required.",
  not_authorized: "You do not have permission to update this profile.",
  action_failed: "That action could not be completed.",
};

export default async function TeacherProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const query = await searchParams;

  // A fresh DB read, not session.user — the JWT session's `name` claim is
  // set once at login and never refreshed on subsequent requests (unlike
  // roles/permissions/isSuperAdmin, which auth.ts's jwt callback does
  // re-resolve every time), so it would otherwise show a stale value
  // immediately after this very page's own update form is submitted.
  const user = (await getOwnProfile(session.user)) ?? session.user;

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <SectionHeader title="Your profile" count={0} />

      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}
      {query.success === "1" && !query.error && <Banner variant="success">Profile updated.</Banner>}

      <Card style={{ padding: "20px", display: "grid", gap: "14px", maxWidth: 420 }}>
        <div>
          <span className={ui.mono}>{user.email}</span>
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

      <Banner variant="success">
        Email changes and password resets are handled by an administrator (see the admin console's user directory) —
        not built here to avoid a parallel identity flow (see Session 02/03).
      </Banner>
    </div>
  );
}
