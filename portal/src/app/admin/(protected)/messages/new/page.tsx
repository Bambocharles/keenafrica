import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listUsers } from "@/lib/users";
import { Banner, Button, Card, Disclosure, EmptyState, Field, Input, SectionHeader, Table } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { startDirectConversationAction } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Choose a recipient and write a message.",
  not_authorized: "You do not have permission to message this user.",
  unsupported_file_type: "That attachment type isn't supported, or its content didn't match its extension.",
  file_too_large: "That attachment is too large.",
  action_failed: "That action could not be completed.",
};

export default async function NewAdminConversationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!(actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.MESSAGES_ADMIN))) {
    return <Banner>You do not have permission to use messaging (requires messages.admin).</Banner>;
  }

  const messagingEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESSAGING);
  if (!messagingEnabled) redirect("/messages");

  const query = await searchParams;
  const search = query.q?.trim();

  const result = search ? await listUsers({ search, pageSize: 20 }, actor) : null;

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <a href="/messages" className={ui.linkMono}>
        ← Messages
      </a>
      <SectionHeader title="New message" count={0} />
      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <Card style={{ padding: "18px", display: "grid", gap: "12px" }}>
        <strong>Find a recipient</strong>
        <form method="get" className={ui.filterBar}>
          <Field label="Search">
            <Input name="q" defaultValue={search ?? ""} placeholder="Name or email" />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {!result ? (
          <p style={{ color: "var(--ink-soft)" }}>Search by name or email to find who to message.</p>
        ) : result.users.length === 0 ? (
          <EmptyState title="No matching users" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role(s)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {result.users.map((u) => (
                <tr key={u.id}>
                  <td className={ui.nameCell}>
                    {u.name}
                    <span className={ui.subCell}>{u.email}</span>
                  </td>
                  <td className={ui.mono}>{u.roles.join(", ") || "—"}</td>
                  <td>
                    <Disclosure label="Message">
                      <form action={startDirectConversationAction} style={{ display: "grid", gap: "10px", width: "100%", gridColumn: "1 / -1" }}>
                        <input type="hidden" name="recipientId" value={u.id} />
                        <input type="hidden" name="q" value={search ?? ""} />
                        <Field label="Message" className={ui.fieldWide}>
                          <textarea name="body" required rows={3} className={ui.input} placeholder={`Message ${u.name}…`} />
                        </Field>
                        <Field label="Attachment (optional)">
                          <input type="file" name="attachment" />
                        </Field>
                        <div className={ui.disclosureActions}>
                          <Button type="submit" variant="primary">
                            Send
                          </Button>
                        </div>
                      </form>
                    </Disclosure>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
