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
  | "missed"
  // Added by Session 14 (Certificates) for Certificate.status.
  | "revoked"
  // Added by Session 17 (Organization Core) for Organization.status /
  // OrganizationMembership.status / OrganizationInvitation.status.
  | "pending"
  | "invited"
  | "removed"
  // Added by Session 38 (Keen Africans — Editor Workflow) for
  // Article.reviewStatus. "not_submitted" intentionally has no badge — the
  // editor UI simply doesn't show a review badge at all in that state (see
  // ArticleEditorClient.tsx), since it's not a real workflow step.
  | "in_review"
  | "changes_requested"
  | "approved"
  | "rejected";

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
  revoked: "Revoked",
  pending: "Pending",
  invited: "Invited",
  removed: "Removed",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
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
    revoked: styles["badge-suspended"],
    pending: styles["badge-paused"],
    invited: styles["badge-draft"],
    removed: styles["badge-suspended"],
    in_review: styles["badge-paused"],
    changes_requested: styles["badge-paused"],
    approved: styles["badge-active"],
    rejected: styles["badge-suspended"],
  }[status];

  return (
    <span className={[styles.badge, toneClass].join(" ")}>
      <span className={styles.badgeDot} aria-hidden />
      {LABEL[status]}
    </span>
  );
}
