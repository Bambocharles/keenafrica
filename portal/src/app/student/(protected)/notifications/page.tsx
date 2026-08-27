import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyNotifications, notificationHref } from "@/lib/notifications";
import { Button, Card, EmptyState, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

const PAGE_SIZE = 20;

export default async function StudentNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = session.user;

  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const { notifications, total, unreadCount, pageSize } = await listMyNotifications(actor, { page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <SectionHeader
        title="Notifications"
        count={unreadCount}
        action={
          unreadCount > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <Button type="submit" variant="secondary">
                Mark all read
              </Button>
            </form>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title="No notifications yet" hint="You'll see updates about messages, assessments, and your courses here." />
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {notifications.map((n) => {
            const href = notificationHref(n);
            const isUnread = !n.readAt;
            const body = (
              <Card
                style={{
                  padding: "14px 16px",
                  display: "grid",
                  gap: "6px",
                  borderColor: isUnread ? "var(--accent, #4f46e5)" : undefined,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {isUnread && (
                      <span
                        aria-label="unread"
                        style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent, #4f46e5)", display: "inline-block" }}
                      />
                    )}
                    <strong>{n.title}</strong>
                  </div>
                  <span className={ui.mono}>{formatDateTime(n.createdAt)}</span>
                </div>
                <p style={{ margin: 0, color: "var(--ink-soft)" }}>{n.body}</p>
              </Card>
            );

            return (
              <div key={n.id} style={{ display: "grid", gap: "6px" }}>
                {href ? (
                  <a href={href} style={{ textDecoration: "none", color: "inherit" }}>
                    {body}
                  </a>
                ) : (
                  body
                )}
                {isUnread && (
                  <form action={markNotificationReadAction} style={{ justifySelf: "end" }}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <Button type="submit" variant="ghost">
                      Mark read
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className={ui.pagination}>
          <span>
            Page {page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            {page > 1 ? <a href={`/notifications?page=${page - 1}`}>Previous</a> : <span className="disabled">Previous</span>}
            {page < totalPages ? <a href={`/notifications?page=${page + 1}`}>Next</a> : <span className="disabled">Next</span>}
          </div>
        </div>
      )}
    </div>
  );
}
