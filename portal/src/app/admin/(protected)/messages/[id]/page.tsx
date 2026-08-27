import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { AuthorizationError } from "@/lib/authz";
import { getConversationThread } from "@/lib/messaging";
import { Banner, Button, Card, Field, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { markReadAction, replyAction } from "../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Write a message before sending.",
  not_authorized: "You are not a participant in this conversation.",
  unsupported_file_type: "That attachment type isn't supported, or its content didn't match its extension.",
  file_too_large: "That attachment is too large.",
  action_failed: "That action could not be completed.",
};

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function AdminConversationThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!(actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.MESSAGES_ADMIN))) {
    return <Banner>You do not have permission to use messaging (requires messages.admin).</Banner>;
  }

  const messagingEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESSAGING);
  if (!messagingEnabled) redirect("/messages");

  const { id: conversationId } = await params;
  const query = await searchParams;

  let thread;
  try {
    thread = await getConversationThread(conversationId, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) return <Banner>You are not a participant in this conversation.</Banner>;
    throw err;
  }

  const others = thread.conversation.participants.filter((p) => p.userId !== actor.id);
  const title = others.map((o) => o.name).join(", ") || "(just you)";

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <a href="/messages" className={ui.linkMono}>
        ← Messages
      </a>
      <SectionHeader title={title} count={thread.messages.length} />
      {query.error && <Banner>{ERROR_MESSAGES[query.error] ?? "Something went wrong."}</Banner>}

      <form action={markReadAction}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <Button type="submit" variant="ghost">
          Mark as read
        </Button>
      </form>

      <div style={{ display: "grid", gap: "10px" }}>
        {thread.messages.map((m) => (
          <Card
            key={m.id}
            style={{
              padding: "12px 14px",
              display: "grid",
              gap: "4px",
              justifySelf: m.senderId === actor.id ? "end" : "start",
              maxWidth: "70%",
              background: m.senderId === actor.id ? "var(--accent-soft)" : "var(--surface-sunken)",
            }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
              <strong>{m.senderId === actor.id ? "You" : m.senderName}</strong>
              <span className={ui.mono} style={{ fontSize: "11px" }}>
                {formatDateTime(m.sentAt)}
              </span>
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{m.body}</p>
            {m.attachment && (
              <a href={`/assets/${m.attachment.assetId}/download`} target="_blank" rel="noreferrer" className={ui.linkMono}>
                📎 {m.attachment.filename}
              </a>
            )}
          </Card>
        ))}
      </div>

      <Card style={{ padding: "16px" }}>
        <form action={replyAction} style={{ display: "grid", gap: "10px" }}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <Field label="Reply">
            <textarea name="body" required rows={3} className={ui.input} placeholder="Write a reply…" />
          </Field>
          <Field label="Attachment (optional)">
            <input type="file" name="attachment" />
          </Field>
          <div>
            <Button type="submit" variant="primary">
              Send
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
