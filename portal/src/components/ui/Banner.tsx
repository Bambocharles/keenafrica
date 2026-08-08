import type { ReactNode } from "react";
import styles from "./styles.module.css";

export function Banner({ children }: { children: ReactNode }) {
  return <div className={[styles.banner, styles["banner-danger"]].join(" ")}>{children}</div>;
}
