"use client";

import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

const TITLES: Array<[prefix: string, title: string]> = [
  ["/dashboard", "Dashboard"],
  ["/courses", "My Learning"],
  ["/practice", "Practice"],
  ["/progress", "My Progress"],
  ["/assessments", "Assignments & Assessments"],
  ["/results", "Results"],
  ["/notes", "Notes"],
  ["/saved", "Saved Resources"],
  ["/certificates", "Certificates"],
  ["/messages", "Messages"],
  ["/notifications", "Notifications"],
  ["/profile", "Profile"],
];

export function TopbarTitle() {
  const pathname = usePathname();
  const title = TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? "Dashboard";
  return <h1 className={styles.topbarTitle}>{title}</h1>;
}
