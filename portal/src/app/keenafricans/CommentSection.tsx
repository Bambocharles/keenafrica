import { renderArticleBodyHtml } from "@/lib/articles";
import { commentAction, deleteCommentAction } from "./actions";
import { ReportForm } from "./ReportForm";
import styles from "./site.module.css";

const COMMENT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many comments recently — try again later.",
  verify_email: "Verify your email address to comment.",
  not_authorized: "Only Keen Africans may comment.",
  not_found: "This article can no longer be commented on.",
  empty: "Write something before submitting.",
  failed: "Could not post that comment — try again.",
};

const COMMENT_DELETE_ERROR_MESSAGES: Record<string, string> = {
  not_found: "That comment is already gone.",
  not_authorized: "You can't remove that comment.",
  failed: "Could not remove that comment — try again.",
};

export interface CommentSummary {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Date;
}

/**
 * Session 43 (Comments & Reactions). Renders every comment body through
 * renderArticleBodyHtml() — the EXACT same marked -> sanitize-html pipeline
 * src/app/keenafricans/articles/[id]/page.tsx already uses for the article
 * body itself, imported directly from src/lib/articles.ts rather than
 * re-implemented here. This is the actual "no separate rendering path for
 * user-generated comments" guarantee at the UI layer, not just in
 * src/lib/comments.ts.
 *
 * A delete control is shown only when the viewer is one of the three
 * self-service tiers src/lib/comments.ts's deleteComment() itself
 * enforces server-side (comment author, article author, or an
 * articles.manage holder) — this is a UI convenience, not the
 * authorization boundary; deleteCommentAction re-checks all three
 * server-side regardless of what this component decides to render.
 */
export function CommentSection({
  articleId,
  articleAuthorId,
  comments,
  viewerId,
  signedIn,
  canManage,
  returnTo,
  commentError,
  commentDeleteError,
  reportedEntityId,
  reportErrorEntityId,
  reportError,
}: {
  articleId: string;
  articleAuthorId: string;
  comments: CommentSummary[];
  viewerId?: string | null;
  signedIn: boolean;
  canManage: boolean;
  returnTo: string;
  commentError?: string;
  commentDeleteError?: string;
  reportedEntityId?: string;
  reportErrorEntityId?: string;
  reportError?: string;
}) {
  return (
    <section className={styles.comments}>
      <h2 className={styles.commentsTitle}>
        Comments {comments.length > 0 && <span className={styles.commentsCount}>({comments.length})</span>}
      </h2>

      {signedIn ? (
        <form action={commentAction} className={styles.commentForm}>
          <input type="hidden" name="articleId" value={articleId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="body"
            required
            maxLength={3000}
            placeholder="Share your thoughts..."
            className={styles.commentTextarea}
          />
          <button type="submit" className={styles.commentSubmit}>
            Post comment
          </button>
          {commentError && COMMENT_ERROR_MESSAGES[commentError] && (
            <p className={styles.followError}>{COMMENT_ERROR_MESSAGES[commentError]}</p>
          )}
        </form>
      ) : (
        <p className={styles.commentSignIn}>
          <a href="/login">Sign in</a> as a Keen African to comment.
        </p>
      )}

      {commentDeleteError && COMMENT_DELETE_ERROR_MESSAGES[commentDeleteError] && (
        <p className={styles.followError}>{COMMENT_DELETE_ERROR_MESSAGES[commentDeleteError]}</p>
      )}

      {comments.length === 0 ? (
        <p className={styles.commentsEmpty}>No comments yet.</p>
      ) : (
        <ul className={styles.commentList}>
          {comments.map((c) => {
            const canDelete = signedIn && (viewerId === c.authorId || viewerId === articleAuthorId || canManage);
            return (
              <li key={c.id} className={styles.commentItem}>
                <div className={styles.commentMeta}>
                  <strong>{c.authorName}</strong>
                  <time dateTime={c.createdAt.toISOString()}>{new Date(c.createdAt).toLocaleDateString()}</time>
                </div>
                <div
                  className={styles.commentBody}
                  dangerouslySetInnerHTML={{ __html: renderArticleBodyHtml(c.body) }}
                />
                <div className={styles.commentActions}>
                  {canDelete && (
                    <form action={deleteCommentAction}>
                      <input type="hidden" name="commentId" value={c.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button type="submit" className={styles.commentDelete}>
                        Delete
                      </button>
                    </form>
                  )}
                  <ReportForm
                    entityType="comment"
                    entityId={c.id}
                    returnTo={returnTo}
                    reported={reportedEntityId === c.id}
                    reportError={reportErrorEntityId === c.id ? reportError : undefined}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
