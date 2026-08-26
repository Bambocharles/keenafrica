import styles from "./styles.module.css";

type Status =
  | "active"
  | "draft"
  | "paused"
  | "suspended"
  | "published"
  | "archived"
  | "completed"
  | "withdrawn"
  | "in_progress"
  | "submitted"
  | "graded";

const LABEL: Record<Status, string> = {
  active: "Active",
  draft: "Draft",
  paused: "Paused",
  suspended: "Suspended",
  published: "Published",
  archived: "Archived",
  completed: "Completed",
  withdrawn: "Withdrawn",
  in_progress: "In progress",
  submitted: "Submitted",
  graded: "Graded",
};

export function StatusBadge({ status }: { status: Status }) {
  const toneClass = {
    active: styles["badge-active"],
    draft: styles["badge-draft"],
    paused: styles["badge-paused"],
    suspended: styles["badge-suspended"],
    published: styles["badge-active"],
    archived: styles["badge-draft"],
    completed: styles["badge-active"],
    withdrawn: styles["badge-suspended"],
    in_progress: styles["badge-paused"],
    submitted: styles["badge-draft"],
    graded: styles["badge-active"],
  }[status];

  return (
    <span className={[styles.badge, toneClass].join(" ")}>
      <span className={styles.badgeDot} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
