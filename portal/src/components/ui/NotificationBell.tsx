/**
 * Shared across all three portals (Session 10) — a topbar link to
 * /notifications with an unread-count badge, computed server-side by each
 * portal's own layout.tsx via getUnreadNotificationCount(). Self-contained
 * (inline styles, not layout.module.css) since each portal has its own,
 * otherwise-unrelated CSS module for the sidebar/topbar chrome.
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <a
      href="/notifications"
      title={unreadCount > 0 ? `${unreadCount} unread notification(s)` : "Notifications"}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        textDecoration: "none",
        color: "inherit",
        fontSize: "16px",
      }}
    >
      <span aria-hidden>🔔</span>
      {unreadCount > 0 && (
        <span
          style={{
            position: "absolute",
            top: "1px",
            right: "1px",
            minWidth: "16px",
            height: "16px",
            padding: "0 4px",
            borderRadius: "8px",
            background: "var(--accent, #4f46e5)",
            color: "var(--accent-ink, #fff)",
            fontSize: "10px",
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
          }}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </a>
  );
}
