import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import styles from "./styles.module.css";

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={[styles.field, className].filter(Boolean).join(" ")}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[styles.input, className].filter(Boolean).join(" ")} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={[styles.input, className].filter(Boolean).join(" ")} {...props} />;
}
