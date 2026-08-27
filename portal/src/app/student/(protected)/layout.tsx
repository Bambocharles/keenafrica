import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { canAccessStudentPortal } from "@/lib/authz";
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

export default async function ProtectedStudentLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  // Coarse "can see the student portal shell" check only (see
  // canAccessStudentPortal's doc comment in src/lib/authz.ts) — every page
  // inside still enforces its own ownership scoping via
  // assertActiveEnrollment/self-scoped queries, so reaching this layout
  // alone grants no data access.
  if (!session?.user || !canAccessStudentPortal(session.user)) {
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

        <NavLinks />

        <div className={styles.foot}>
          <div className={styles.footRow}>
            <div style={{ minWidth: 0 }}>
              <div className={styles.userName}>{user.name ?? "Student"}</div>
              <div className={styles.userEmail}>{user.email}</div>
            </div>
            <span className={styles.envTag}>Student</span>
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
