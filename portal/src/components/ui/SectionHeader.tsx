import type { ReactNode } from "react";
import styles from "./styles.module.css";

export function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action?: ReactNode;
}) {
  return (
    <div className={styles.sectionHead}>
      <div className={styles.sectionHeadLeft}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <span className={styles.sectionCount}>{count}</span>
      </div>
      {action}
    </div>
  );
}
