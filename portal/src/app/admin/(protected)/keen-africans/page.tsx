import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import {
  ARTICLE_TOPIC_LABELS,
  listArticlesForModeration,
  listArticlesPendingReview,
  type ArticleModerationStatus,
} from "@/lib/articles";
import { listPendingVerificationReviews } from "@/lib/verification";
import { listReports } from "@/lib/reports";
import {
  adminDeleteCommentAction,
  adminUnpublishArticleAction,
  approveArticleAction,
  approveVerificationAction,
  dismissReportAction,
  rejectArticleAction,
  rejectVerificationAction,
  requestChangesAction,
  resolveReportAction,
} from "./actions";
import { Banner, Button, Card, EmptyState, SectionHeader } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  reason_required: "A reason is required to unpublish an article.",
  note_required: "A note is required so the author knows what to change.",
  not_authorized: "You do not have permission to do that.",
  invalid_review_transition: "That article isn't awaiting review anymore.",
  verification_reason_required: "A reason is required to reject or revoke a verification.",
  verification_not_found: "That account has no pending LinkedIn connection.",
  invalid_verification_transition: "That account's verification status already changed — refresh and try again.",
  report_not_found: "That report no longer exists.",
  report_already_reviewed: "That report was already reviewed — refresh to see the current queue.",
  comment_not_found: "That comment is already gone.",
  action_failed: "Could not complete that action.",
};

const MODERATION_TABS: Array<{ value: ArticleModerationStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "pending_review", label: "Pending review" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
];

/**
 * The Admin/Troubleshooter moderation safety valve (Session 34 — Keen
 * Africans). A flat "every published article" list is the deliberately
 * minimal v1 queue this session's brief allows — see docs/KEEN_AFRICANS.md
 * for what's deferred to v2 (a real flagged/reported queue, filters).
 */
export default async function AdminKeenAfricansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string; reported?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const canModerateArticles = user.isSuperAdmin || hasPermission(user, PERMISSIONS.ARTICLES_MANAGE);
  const canReviewVerifications = user.isSuperAdmin || hasPermission(user, PERMISSIONS.VERIFICATION_REVIEW);
  if (!canModerateArticles && !canReviewVerifications) {
    redirect("/dashboard");
  }

  const { error, status: statusParam, reported: reportedParam } = await searchParams;
  const status = (MODERATION_TABS.map((t) => t.value).includes(statusParam as ArticleModerationStatus)
    ? statusParam
    : undefined) as ArticleModerationStatus | undefined;
  const reportedOnly = reportedParam === "1";

  const [articles, pendingReview, pendingVerifications, pendingReports] = await Promise.all([
    canModerateArticles ? listArticlesForModeration(user, { status, reportedOnly }) : Promise.resolve([]),
    canModerateArticles ? listArticlesPendingReview(user) : Promise.resolve([]),
    canReviewVerifications ? listPendingVerificationReviews(user) : Promise.resolve([]),
    canModerateArticles ? listReports(user, { status: "pending" }) : Promise.resolve([]),
  ]);

  function queueHref(next: { status?: string; reported?: boolean }) {
    const qs = new URLSearchParams();
    const nextStatus = next.status !== undefined ? next.status : status;
    const nextReported = next.reported !== undefined ? next.reported : reportedOnly;
    if (nextStatus) qs.set("status", nextStatus);
    if (nextReported) qs.set("reported", "1");
    const query = qs.toString();
    return `/keen-africans${query ? `?${query}` : ""}`;
  }

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

      {canModerateArticles && (
        <section>
          <SectionHeader
            title="Reports"
            count={pendingReports.length}
            action={
              <a href="/keen-africans/users" className={ui.linkMono}>
                Manage Keen Africans →
              </a>
            }
          />
          <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 12 }}>
            Open reports against an article or a profile, filed by a reader (logged in or anonymous). Resolving
            means you've acted on it (e.g. unpublished the article or suspended the account below); dismissing
            means no action was warranted. Both are audited.
          </p>

          {pendingReports.length === 0 ? (
            <EmptyState title="Nothing reported" />
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {pendingReports.map((r) => (
                <Card key={r.id} style={{ padding: "14px 16px" }}>
                  <div className={ui.nameCell}>
                    {r.entityType === "article" ? "Article report" : r.entityType === "profile" ? "Profile report" : "Comment report"}
                    {r.entityType === "article" && (
                      <>
                        {" "}
                        &middot; <a href="/keen-africans?reported=1">view in queue</a>
                      </>
                    )}
                    {r.entityType === "profile" && (
                      <>
                        {" "}
                        &middot; <a href={`/keen-africans/users/${r.entityId}`}>view profile</a>
                      </>
                    )}
                  </div>
                  <div className={ui.subCell} style={{ marginBottom: 10 }}>
                    Reason: &ldquo;{r.reason}&rdquo; &middot; reported by{" "}
                    {r.reporterEmail ?? "an anonymous reader"} on {new Date(r.createdAt).toLocaleDateString()}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <form action={resolveReportAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="hidden" name="reportId" value={r.id} />
                      <input type="text" name="note" placeholder="Note (optional)" className={ui.input} />
                      <Button type="submit">Resolve</Button>
                    </form>
                    <form action={dismissReportAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="hidden" name="reportId" value={r.id} />
                      <input type="text" name="note" placeholder="Note (optional)" className={ui.input} />
                      <Button type="submit" variant="outline">
                        Dismiss
                      </Button>
                    </form>
                    {r.entityType === "comment" && (
                      <form action={adminDeleteCommentAction}>
                        <input type="hidden" name="commentId" value={r.entityId} />
                        <Button type="submit" variant="danger">
                          Remove comment
                        </Button>
                      </form>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {canReviewVerifications && (
        <section>
          <SectionHeader title="Verification review" count={pendingVerifications.length} />
          <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 12 }}>
            Accounts that connected LinkedIn and are awaiting review. Approving grants the public{" "}
            <strong>Verified Keen African ✓</strong> badge; connecting LinkedIn alone never does. This is a minimal
            v1 queue (Session 40) — a fuller moderation console is Session 41's territory.
          </p>

          {pendingVerifications.length === 0 ? (
            <EmptyState title="Nothing awaiting review" />
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {pendingVerifications.map((v) => (
                <Card key={v.id} style={{ padding: "14px 16px" }}>
                  <div className={ui.nameCell}>
                    {v.user.name} ({v.user.email})
                  </div>
                  <div className={ui.subCell} style={{ marginBottom: 10 }}>
                    Connected LinkedIn as <strong>{v.linkedinName ?? "(no name on file)"}</strong>
                    {v.connectedAt && ` on ${new Date(v.connectedAt).toLocaleDateString()}`}
                    {v.linkedinPictureUrl && (
                      <>
                        {" "}
                        &middot;{" "}
                        <a href={v.linkedinPictureUrl} target="_blank" rel="noreferrer">
                          view photo ↗
                        </a>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <form action={approveVerificationAction}>
                      <input type="hidden" name="userId" value={v.userId} />
                      <Button type="submit">Approve</Button>
                    </form>
                    <form action={rejectVerificationAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="hidden" name="userId" value={v.userId} />
                      <input type="text" name="reason" required placeholder="Reason for rejecting" className={ui.input} />
                      <Button type="submit" variant="danger">
                        Reject
                      </Button>
                    </form>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {canModerateArticles && (
      <>
      <section>
        <SectionHeader title="Pending review" count={pendingReview.length} />
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 12 }}>
          Articles a Keen African has submitted for review (opt-in — most authors publish directly and never appear
          here). Approving does not publish the article itself; the author still publishes (or schedules) it once
          approved.
        </p>

        {pendingReview.length === 0 ? (
          <EmptyState title="Nothing awaiting review" />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {pendingReview.map((a) => (
              <Card key={a.id} style={{ padding: "14px 16px" }}>
                <div className={ui.nameCell}>{a.title}</div>
                <div className={ui.subCell} style={{ marginBottom: 10 }}>
                  By {a.author.name} ({a.author.email}) &middot; submitted {new Date(a.updatedAt).toLocaleDateString()}
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <form action={approveArticleAction}>
                    <input type="hidden" name="articleId" value={a.id} />
                    <Button type="submit">Approve</Button>
                  </form>
                  <form action={requestChangesAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input type="hidden" name="articleId" value={a.id} />
                    <input type="text" name="note" required placeholder="What needs to change?" className={ui.input} />
                    <Button type="submit" variant="outline">
                      Request changes
                    </Button>
                  </form>
                  <form action={rejectArticleAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input type="hidden" name="articleId" value={a.id} />
                    <input type="text" name="reason" required placeholder="Reason for rejecting" className={ui.input} />
                    <Button type="submit" variant="danger">
                      Reject
                    </Button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader title="Article moderation queue" count={articles.length} />
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 12 }}>
          Every article on keenafricans.{process.env.ROOT_DOMAIN ?? "keenafrica.com"} that has ever been submitted
          for review, published, or rejected — filterable by status and by whether it's currently reported.
          Unpublishing a published article returns it to its author's drafts (not archived) and is recorded in the
          audit log with your reason.
        </p>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          {MODERATION_TABS.map((tab) => (
            <a
              key={tab.value || "all"}
              href={queueHref({ status: tab.value || undefined })}
              className={ui.roleTag}
              style={
                (status ?? "") === tab.value
                  ? { fontWeight: 700, textDecoration: "underline" }
                  : undefined
              }
            >
              {tab.label}
            </a>
          ))}
          <a href={queueHref({ reported: !reportedOnly })} className={ui.roleTag} style={reportedOnly ? { fontWeight: 700, textDecoration: "underline" } : undefined}>
            {reportedOnly ? "✓ Reported only" : "Reported only"}
          </a>
        </div>

        {articles.length === 0 ? (
          <EmptyState title="No articles match this filter" />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {articles.map((a) => (
              <Card key={a.id} style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <div className={ui.nameCell}>
                      {a.title}
                      {a.reported && (
                        <span className={ui.roleTag} style={{ marginLeft: 8, color: "var(--danger, #c0392b)" }}>
                          Reported
                        </span>
                      )}
                    </div>
                    <div className={ui.subCell}>
                      By {a.author.name} ({a.author.email}) &middot; status: {a.status}
                      {a.reviewStatus !== "not_submitted" && ` · review: ${a.reviewStatus}`}
                      {a.topic && ` · ${ARTICLE_TOPIC_LABELS[a.topic]}`}
                      {a.moderatedAt && " · previously moderated"}
                    </div>
                  </div>
                  {a.status === "published" && (
                    <a
                      href={`https://keenafricans.${process.env.ROOT_DOMAIN ?? "keenafrica.com"}/articles/${a.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12.5, color: "var(--accent)", alignSelf: "center" }}
                    >
                      View live ↗
                    </a>
                  )}
                </div>
                {a.status === "published" && (
                  <form
                    action={adminUnpublishArticleAction}
                    style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center" }}
                  >
                    <input type="hidden" name="articleId" value={a.id} />
                    <input
                      type="text"
                      name="reason"
                      required
                      placeholder="Reason for unpublishing (required, audited)"
                      className={ui.input}
                      style={{ flex: 1 }}
                    />
                    <Button type="submit" variant="danger">
                      Unpublish
                    </Button>
                  </form>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
      </>
      )}
    </div>
  );
}
