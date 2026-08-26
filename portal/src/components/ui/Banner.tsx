import type { ReactNode } from "react";
import styles from "./styles.module.css";

type Variant = "danger" | "success";

export function Banner({ children, variant = "danger" }: { children: ReactNode; variant?: Variant }) {
  return <div className={[styles.banner, styles[`banner-${variant}`]].join(" ")}>{children}</div>;
}
