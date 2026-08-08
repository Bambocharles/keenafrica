import type { ButtonHTMLAttributes } from "react";
import styles from "./styles.module.css";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const variantClass = {
    primary: styles["btn-primary"],
    secondary: styles["btn-secondary"],
    outline: styles["btn-outline"],
    ghost: styles["btn-ghost"],
    danger: styles["btn-danger"],
  }[variant];

  return (
    <button
      className={[styles.btn, variantClass, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
