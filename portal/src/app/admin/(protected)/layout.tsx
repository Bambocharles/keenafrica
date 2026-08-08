import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
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
  if (!session?.user?.isSuperAdmin) {
    redirect("/login");
  }
  const user = session.user;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a href="/dashboard" className={styles.brand}>
          <span className={styles.mark}>K</span>
          Keen Africa
        </a>

        <nav className={styles.nav}>
          <a href="/dashboard" className={`${styles.navLink} ${styles.navLinkActive}`}>
            <span className={styles.navIcon}>&#9638;</span>
            Dashboard
          </a>
          <a href="/dashboard#sponsors" className={styles.navLink}>
            <span className={styles.navIcon}>&#9678;</span>
            Sponsors
          </a>
          <a href="/dashboard#projects" className={styles.navLink}>
            <span className={styles.navIcon}>&#9636;</span>
            Projects
          </a>
        </nav>

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
          <h1 className={styles.topbarTitle}>Dashboard</h1>
          <div className={styles.avatar} title={user.email ?? undefined}>
            {initials(user.name, user.email)}
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
