import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, hasPermission } from "@/lib/authz";
import { listAllPublishedArticlesForAdmin, listArticlesPendingReview } from "@/lib/articles";
import { listPendingVerificationReviews } from "@/lib/verification";
import {
  adminUnpublishArticleAction,
  approveArticleAction,
  approveVerificationAction,
  rejectArticleAction,
  rejectVerificationAction,
  requestChangesAction,
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
  action_failed: "Could not complete that action.",
};

/**
 * The Admin/Troubleshooter moderation safety valve (Session 34 — Keen
 * Africans). A flat "every published article" list is the deliberately
 * minimal v1 queue this session's brief allows — see docs/KEEN_AFRICANS.md
 * for what's deferred to v2 (a real flagged/reported queue, filters).
 */
export default async function AdminKeenAfricansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  const canModerateArticles = user.isSuperAdmin || hasPermission(user, PERMISSIONS.ARTICLES_MANAGE);
  const canReviewVerifications = user.isSuperAdmin || hasPermission(user, PERMISSIONS.VERIFICATION_REVIEW);
  if (!canModerateArticles && !canReviewVerifications) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;
  const [articles, pendingReview, pendingVerifications] = await Promise.all([
    canModerateArticles ? listAllPublishedArticlesForAdmin(user) : Promise.resolve([]),
    canModerateArticles ? listArticlesPendingReview(user) : Promise.resolve([]),
    canReviewVerifications ? listPendingVerificationReviews(user) : Promise.resolve([]),
  ]);

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}

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
        <SectionHeader title="Published articles" count={articles.length} />
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: -4, marginBottom: 12 }}>
          Every published article on keenafricans.{process.env.ROOT_DOMAIN ?? "keenafrica.com"}. Unpublishing returns
          an article to its author's drafts (not archived) and is recorded in the audit log with your reason.
        </p>

        {articles.length === 0 ? (
          <EmptyState title="No published articles yet" />
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {articles.map((a) => (
              <Card key={a.id} style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <div className={ui.nameCell}>{a.title}</div>
                    <div className={ui.subCell}>
                      By {a.author.name} ({a.author.email}) &middot; published{" "}
                      {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "—"}
                      {a.moderatedAt && " · previously moderated"}
                    </div>
                  </div>
                  <a
                    href={`https://keenafricans.${process.env.ROOT_DOMAIN ?? "keenafrica.com"}/articles/${a.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12.5, color: "var(--accent)", alignSelf: "center" }}
                  >
                    View live ↗
                  </a>
                </div>
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
