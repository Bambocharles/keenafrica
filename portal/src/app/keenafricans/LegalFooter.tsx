import styles from "./site.module.css";

/** Shared by every public keenafricans page (listing, article, register, login) — one place to update if these links ever change. */
export function LegalFooter() {
  return (
    <footer className={styles.legalFooter}>
      <a href="/terms">Terms of Service</a>
      <span aria-hidden>&middot;</span>
      <a href="/privacy">Privacy Policy</a>
    </footer>
  );
}
