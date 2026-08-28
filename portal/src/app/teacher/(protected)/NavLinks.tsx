"use client";

import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

export function NavLinks() {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/dashboard", icon: "▣", label: "Dashboard" },
    { href: "/courses", icon: "🎓", label: "My Courses" },
    { href: "/messages", icon: "✉", label: "Messages" },
    { href: "/assessments", icon: "✓", label: "Assessments" },
    { href: "/notifications", icon: "🔔", label: "Notifications" },
    { href: "/organization", icon: "🏫", label: "Organization" },
    { href: "/profile", icon: "◉", label: "Profile" },
    { href: "/security", icon: "🔒", label: "Security" },
  ];

  return (
    <nav className={styles.nav}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
