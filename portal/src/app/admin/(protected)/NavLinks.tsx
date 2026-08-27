"use client";

import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

interface NavItem {
  href: string;
  icon: string;
  label: string;
  /** Path prefix used to decide "active" — defaults to href. */
  activePrefix?: string;
}

export function NavLinks({
  showUsers,
  showAudit,
  showEducation,
  showMessages,
  showReports,
  showCertificates,
}: {
  showUsers: boolean;
  showAudit: boolean;
  showEducation: boolean;
  showMessages: boolean;
  showReports: boolean;
  showCertificates: boolean;
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/dashboard", icon: "▣", label: "Dashboard" },
    { href: "/dashboard#sponsors", icon: "◈", label: "Sponsors", activePrefix: "__never__" },
    { href: "/dashboard#projects", icon: "▬", label: "Projects", activePrefix: "__never__" },
    ...(showEducation ? [{ href: "/education", icon: "🎓", label: "Courses" }] : []),
    ...(showReports ? [{ href: "/reports", icon: "📊", label: "Reports" }] : []),
    ...(showCertificates ? [{ href: "/certificates", icon: "🏅", label: "Certificates" }] : []),
    ...(showUsers ? [{ href: "/users", icon: "◉", label: "Users" }] : []),
    ...(showMessages ? [{ href: "/messages", icon: "✉", label: "Messages" }] : []),
    ...(showAudit ? [{ href: "/audit", icon: "☰", label: "Audit Log" }] : []),
    { href: "/flags", icon: "⚑", label: "Feature Flags" },
    { href: "/notifications", icon: "🔔", label: "Notifications" },
  ];

  return (
    <nav className={styles.nav}>
      {items.map((item) => {
        const prefix = item.activePrefix ?? item.href;
        const active = prefix !== "__never__" && (pathname === prefix || pathname.startsWith(`${prefix}/`));
        return (
          <a
            key={item.href}
            href={item.href}
            className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
