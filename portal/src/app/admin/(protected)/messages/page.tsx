import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { isFeatureEnabled, FEATURE_FLAGS } from "@/lib/feature-flags";
import { listMyConversations } from "@/lib/messaging";
import { Banner, Button, Card, EmptyState, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

const TYPE_LABEL: Record<string, string> = { direct: "Direct", group: "Group", cohort_broadcast: "Cohort broadcast" };

export default async function AdminMessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  if (!(actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.MESSAGES_ADMIN))) {
    return <Banner>You do not have permission to use messaging (requires messages.admin).</Banner>;
  }

  const messagingEnabled = await isFeatureEnabled(FEATURE_FLAGS.MESSAGING);
  if (!messagingEnabled) {
    return (
      <div style={{ display: "grid", gap: "16px" }}>
        <SectionHeader title="Messages" count={0} />
        <Banner>
          Messaging is built but not yet turned on — toggle the &quot;messaging&quot; feature flag on the Feature Flags
          page to enable it platform-wide.
        </Banner>
      </div>
    );
  }

  const conversations = await listMyConversations(actor);

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader
        title="Messages"
        count={conversations.length}
        action={
          <a href="/messages/new">
            <Button variant="primary" type="button">
              New message
            </Button>
          </a>
        }
      />

      {conversations.length === 0 ? (
        <EmptyState title="No conversations yet" hint="Search for any user from &quot;New message&quot; to start a conversation." />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {conversations.map((c) => {
            const others = c.participants.filter((p) => p.userId !== actor.id);
            const title = others.map((o) => o.name).join(", ") || "(just you)";
            return (
              <a key={c.id} href={`/messages/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <Card style={{ padding: "14px 16px", display: "grid", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <strong>{title}</strong>
                      <span className={ui.roleTag}>{TYPE_LABEL[c.type] ?? c.type}</span>
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {c.unreadCount > 0 && (
                        <span className={ui.roleTag} style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                          {c.unreadCount} unread
                        </span>
                      )}
                      <span className={ui.mono}>{c.lastMessageAt ? formatDateTime(c.lastMessageAt) : ""}</span>
                    </div>
                  </div>
                  {c.lastMessage && (
                    <p style={{ margin: 0, color: "var(--ink-soft)" }}>
                      <strong>{c.lastMessage.senderId === actor.id ? "You" : c.lastMessage.senderName}:</strong> {c.lastMessage.body}
                    </p>
                  )}
                </Card>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
