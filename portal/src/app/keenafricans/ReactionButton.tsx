import { reactAction, unreactAction } from "./actions";
import styles from "./site.module.css";

const REACTION_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many reactions recently — try again later.",
  verify_email: "Verify your email address to react.",
  not_authorized: "Only Keen Africans may react.",
  not_found: "This article can no longer be reacted to.",
  failed: "Could not complete that action — try again.",
};

/**
 * Session 43 (Comments & Reactions). Same "plain <form action> toggle, no
 * client JS" shape as FollowButton.tsx — reactAction/unreactAction
 * (src/app/keenafricans/actions.ts) are the real server-side authorization
 * boundary (src/lib/reactions.ts), not this component.
 */
export function ReactionButton({
  articleId,
  signedIn,
  reacted,
  count,
  returnTo,
  reactionError,
}: {
  articleId: string;
  signedIn: boolean;
  reacted: boolean;
  count: number;
  returnTo: string;
  reactionError?: string;
}) {
  if (!signedIn) {
    return (
      <a href="/login" className={styles.followSignIn}>
        Sign in to react ({count})
      </a>
    );
  }

  return (
    <div>
      <form action={reacted ? unreactAction : reactAction}>
        <input type="hidden" name="articleId" value={articleId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button type="submit" className={reacted ? styles.followButtonActive : styles.followButton}>
          {reacted ? "★ Reacted" : "☆ React"} ({count})
        </button>
      </form>
      {reactionError && REACTION_ERROR_MESSAGES[reactionError] && (
        <p className={styles.followError}>{REACTION_ERROR_MESSAGES[reactionError]}</p>
      )}
    </div>
  );
}
