import type { ReactNode } from "react";
import styles from "./styles.module.css";

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className={styles.disclosure}>
      <summary className={styles.disclosureSummary}>
        <span className={styles.disclosureIcon} aria-hidden>
          +
        </span>
        {label}
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}
