import styles from "./styles.module.css";

type Status = "active" | "draft" | "paused";

const LABEL: Record<Status, string> = {
  active: "Active",
  draft: "Draft",
  paused: "Paused",
};

export function StatusBadge({ status }: { status: Status }) {
  const toneClass = {
    active: styles["badge-active"],
    draft: styles["badge-draft"],
    paused: styles["badge-paused"],
  }[status];

  return (
    <span className={[styles.badge, toneClass].join(" ")}>
      <span className={styles.badgeDot} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
