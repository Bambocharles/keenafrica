import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { canAccessAdminConsole, hasPermission, PERMISSIONS } from "@/lib/authz";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { NotificationBell } from "@/components/ui";
import { TopbarTitle } from "./TopbarTitle";
import { NavLinks } from "./NavLinks";
import styles from "./layout.module.css";

function initials(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  // Extended off the old isSuperAdmin-only gate (Session 03) onto Session
  // 02's Role/Permission model — this is only the coarse "can see the
  // console shell" check. Every page/action inside still enforces its own
  // requirePermission()/requireOwnResourceOrPermission(), so a
  // TROUBLESHOOTER (say) reaching this layout does not imply it can do
  // anything beyond its actual, narrower permission set.
  if (!session?.user || !canAccessAdminConsole(session.user)) {
    redirect("/login");
  }
  const user = session.user;
  const unreadCount = await getUnreadNotificationCount(user);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a href="/dashboard" className={styles.brand}>
          <span className={styles.mark}>K</span>
          Keen Africa
        </a>

        <NavLinks
          showUsers={hasPermission(user, PERMISSIONS.USERS_READ)}
          showAudit={hasPermission(user, PERMISSIONS.AUDIT_READ)}
          showEducation={hasPermission(user, PERMISSIONS.COURSES_MANAGE)}
          showMessages={user.isSuperAdmin || hasPermission(user, PERMISSIONS.MESSAGES_ADMIN)}
          showReports={user.isSuperAdmin || hasPermission(user, PERMISSIONS.COURSES_MANAGE)}
        />

        <div className={styles.foot}>
          <div className={styles.footRow}>
            <div style={{ minWidth: 0 }}>
              <div className={styles.userName}>{user.name ?? "Admin"}</div>
              <div className={styles.userEmail}>{user.email}</div>
            </div>
            <span className={styles.envTag}>Production</span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className={styles.logout}>
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <TopbarTitle />
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <NotificationBell unreadCount={unreadCount} />
            <div className={styles.avatar} title={user.email ?? undefined}>
              {initials(user.name, user.email)}
            </div>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
