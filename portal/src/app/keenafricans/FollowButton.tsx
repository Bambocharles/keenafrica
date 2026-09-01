import { followAction, unfollowAction } from "./actions";
import styles from "./site.module.css";

const FOLLOW_ERROR_MESSAGES: Record<string, string> = {
  cannot_follow_self: "You can't follow yourself.",
  already_following: "You're already following this account.",
  not_found: "That account couldn't be found.",
  failed: "Could not complete that action — try again.",
};

/**
 * Session 42 (Follow & Author Reputation Display). Shared follow/unfollow
 * entry point for both slots this session fills — the public profile
 * page's header and the article byline — same "one shared renderer, no
 * drift between pages" shape as VerificationBadge.tsx. A plain
 * `<form action={...}>` toggle, no client JS, same convention ReportForm
 * uses: `followAction`/`unfollowAction` (src/app/keenafricans/actions.ts)
 * are the actual server-side authorization boundary (src/lib/follows.ts),
 * not this component.
 *
 * Renders nothing when viewing your own profile/byline (isSelf) — the
 * server-side CannotFollowSelfError guard in src/lib/follows.ts is the
 * real enforcement; this is just not offering a control that could only
 * ever fail.
 */
export function FollowButton({
  targetUserId,
  isSelf,
  signedIn,
  following,
  returnTo,
  followError,
}: {
  targetUserId: string;
  isSelf: boolean;
  signedIn: boolean;
  following: boolean;
  returnTo: string;
  followError?: string;
}) {
  if (isSelf) return null;

  if (!signedIn) {
    return (
      <a href="/login" className={styles.followSignIn}>
        Sign in to follow
      </a>
    );
  }

  return (
    <div>
      <form action={following ? unfollowAction : followAction}>
        <input type="hidden" name="targetUserId" value={targetUserId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button type="submit" className={following ? styles.followButtonActive : styles.followButton}>
          {following ? "Following" : "Follow"}
        </button>
      </form>
      {followError && FOLLOW_ERROR_MESSAGES[followError] && (
        <p className={styles.followError}>{FOLLOW_ERROR_MESSAGES[followError]}</p>
      )}
    </div>
  );
}
