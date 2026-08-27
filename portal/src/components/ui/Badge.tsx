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
  | "graded"
  | "weak"
  | "developing"
  | "strong"
  | "exposure_only"
  // Added by Session 11 (Sponsor) for Milestone.status.
  | "planned"
  | "achieved"
  | "missed";

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
  weak: "Weak",
  developing: "Developing",
  strong: "Strong",
  exposure_only: "Exposure only",
  planned: "Planned",
  achieved: "Achieved",
  missed: "Missed",
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
    weak: styles["badge-suspended"],
    developing: styles["badge-paused"],
    strong: styles["badge-active"],
    exposure_only: styles["badge-draft"],
    planned: styles["badge-draft"],
    achieved: styles["badge-active"],
    missed: styles["badge-suspended"],
  }[status];

  return (
    <span className={[styles.badge, toneClass].join(" ")}>
      <span className={styles.badgeDot} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
