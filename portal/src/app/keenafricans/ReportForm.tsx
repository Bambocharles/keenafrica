import { reportAction } from "./actions";
import styles from "./ReportForm.module.css";

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). Shared
 * report entry point for an article or a profile — no login required (this
 * session's explicit rule). A plain <details>/<summary> disclosure needs
 * no client JS; `reportAction` (src/app/keenafricans/actions.ts) is
 * rate-limited server-side (src/lib/reports.ts, reusing
 * src/lib/rate-limit.ts) so this can't become its own abuse vector.
 */
export function ReportForm({
  entityType,
  entityId,
  returnTo,
  reported,
  reportError,
}: {
  entityType: "article" | "profile";
  entityId: string;
  returnTo: string;
  reported?: boolean;
  reportError?: string;
}) {
  if (reported) {
    return <p className={styles.notice}>Thanks — this report has been sent to our moderators.</p>;
  }

  const errorMessage: Record<string, string> = {
    rate_limited: "Too many reports submitted recently — try again later.",
    not_found: "This could not be reported (it may have already been removed).",
    reason_required: "Enter a reason before submitting.",
    invalid: "Could not submit that report.",
    failed: "Could not submit that report — try again.",
  };

  return (
    <details className={styles.wrap}>
      <summary className={styles.trigger}>Report this {entityType === "article" ? "article" : "profile"}</summary>
      {reportError && errorMessage[reportError] && <p className={styles.notice}>{errorMessage[reportError]}</p>}
      <form action={reportAction} className={styles.form}>
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <textarea
          name="reason"
          required
          maxLength={500}
          placeholder="Why are you reporting this? (spam, harassment, impersonation, ...)"
          className={styles.textarea}
        />
        <button type="submit" className={styles.submit}>
          Submit report
        </button>
      </form>
    </details>
  );
}
