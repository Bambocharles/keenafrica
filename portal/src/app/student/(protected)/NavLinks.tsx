"use client";

import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: "/dashboard", icon: "▣", label: "Dashboard" },
  { href: "/courses", icon: "🎓", label: "My Learning" },
  { href: "/practice", icon: "✎", label: "Practice" },
  { href: "/progress", icon: "◔", label: "My Progress" },
  { href: "/assessments", icon: "☑", label: "Assignments" },
  { href: "/results", icon: "▤", label: "Results" },
  { href: "/notes", icon: "🗒", label: "Notes" },
  { href: "/saved", icon: "☆", label: "Saved" },
  { href: "/certificates", icon: "🏅", label: "Certificates" },
  { href: "/messages", icon: "✉", label: "Messages" },
  { href: "/profile", icon: "◉", label: "Profile" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {ITEMS.map((item) => {
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
