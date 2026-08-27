"use client";

import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

const TITLES: Array<[prefix: string, title: string]> = [
  ["/dashboard", "Dashboard"],
  ["/users", "Users"],
  ["/audit", "Audit Log"],
  ["/flags", "Feature Flags"],
  ["/notifications", "Notifications"],
];

export function TopbarTitle() {
  const pathname = usePathname();
  const title = TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? "Dashboard";
  return <h1 className={styles.topbarTitle}>{title}</h1>;
}
