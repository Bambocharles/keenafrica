import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getArticleForEdit, renderArticleBodyHtml, ArticleNotFoundError } from "@/lib/articles";
import { AuthorizationError } from "@/lib/authz";
import { isEmailVerified } from "@/lib/email-verification";
import { getUsernamesByUserIds } from "@/lib/profiles";
import { Banner, Button, Card, Field, Input, StatusBadge } from "@/components/ui";
import { ArticleEditorClient } from "./ArticleEditorClient";
import {
  archiveArticleAction,
  cancelScheduledPublishAction,
  publishArticleAction,
  removeCoverImageAction,
  scheduleArticleAction,
  setCoverImageAction,
  submitForReviewAction,
  unpublishArticleAction,
  updateArticleSlugAction,
} from "../../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Title is required.",
  email_not_verified: "Verify your email before publishing — see your dashboard.",
  not_authorized: "You can only edit your own articles.",
  not_found: "That article no longer exists.",
  unsupported_file_type: "That file type isn't supported for a cover image.",
  file_too_large: "That file is too large.",
  review_not_approved: "This article needs to be approved by a reviewer before it can be published.",
  invalid_review_transition: "That review action isn't valid right now.",
  invalid_slug: "URLs can only contain lowercase letters, numbers, and hyphens.",
  slug_taken: "That URL is already taken by another article.",
  invalid_schedule: "Pick a publish time in the future.",
  action_failed: "Something went wrong.",
};

/** Review states that block a plain author from publishing — see src/lib/articles.ts's assertReviewApproved(). 'not_submitted'/'approved' are the two states publishing is allowed from. */
const REVIEW_BLOCKS_PUBLISH = new Set(["in_review", "changes_requested", "rejected"]);

export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  const { id } = await params;
  const { error, saved } = await searchParams;

  let article;
  try {
    article = await getArticleForEdit(id, user);
  } catch (err) {
    if (err instanceof ArticleNotFoundError || err instanceof AuthorizationError) {
      redirect("/dashboard");
    }
    throw err;
  }

  const [verified, rootDomain, authorUsernames] = await Promise.all([
    isEmailVerified(user.id),
    process.env.ROOT_DOMAIN ?? "keenafrica.com",
    // Not necessarily the current actor's own username — an admin
    // (articles.manage) can reach this page for someone else's article.
    getUsernamesByUserIds([article.authorId]),
  ]);
  const authorUsername = authorUsernames.get(article.authorId) ?? null;
  const articlePublicPath = authorUsername ? `/${authorUsername}/${article.slug}` : `/articles/${article.slug}`;
  const preview = article.body ? renderArticleBodyHtml(article.body) : "";
  const isOwner = article.authorId === user.id;
  const reviewBlocksPublish = REVIEW_BLOCKS_PUBLISH.has(article.reviewStatus) && !user.isSuperAdmin && !user.permissions.includes("articles.manage");
  const canPublish = verified && !reviewBlocksPublish;
  const publishDisabledReason = !verified ? "Verify your email to publish" : reviewBlocksPublish ? "Awaiting review approval" : undefined;

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: 760 }}>
      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}
      {saved && !error && <Banner variant="success">Saved.</Banner>}

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <StatusBadge status={article.status} />
        {article.reviewStatus !== "not_submitted" && <StatusBadge status={article.reviewStatus} />}
        {article.status === "published" && (
          <a href={`https://keenafricans.${rootDomain}${articlePublicPath}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            View live ↗
          </a>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {article.status === "draft" && article.reviewStatus === "not_submitted" && isOwner && (
            <form action={submitForReviewAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" variant="outline">
                Submit for review
              </Button>
            </form>
          )}
          {article.status === "draft" && (article.reviewStatus === "changes_requested" || article.reviewStatus === "rejected") && isOwner && (
            <form action={submitForReviewAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" variant="outline">
                Resubmit for review
              </Button>
            </form>
          )}
          {article.status !== "published" && (
            <form action={publishArticleAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" disabled={!canPublish} title={publishDisabledReason}>
                Publish
              </Button>
            </form>
          )}
          {article.status === "published" && (
            <form action={unpublishArticleAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" variant="outline">
                Unpublish
              </Button>
            </form>
          )}
          {article.status !== "archived" && (
            <form action={archiveArticleAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" variant="danger">
                Archive
              </Button>
            </form>
          )}
        </div>
      </div>

      {(article.reviewStatus === "changes_requested" || article.reviewStatus === "rejected") && article.reviewNote && (
        <Banner>
          {article.reviewStatus === "rejected" ? "Rejected" : "Changes requested"}: {article.reviewNote}
        </Banner>
      )}
      {article.reviewStatus === "in_review" && <Banner variant="success">Submitted — awaiting review.</Banner>}

      {article.status !== "published" && (
        <Card style={{ padding: "18px 20px" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Scheduled publishing</h3>
          {article.scheduledAt ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5 }}>
                Scheduled to publish {new Date(article.scheduledAt).toLocaleString()}
              </span>
              <form action={cancelScheduledPublishAction}>
                <input type="hidden" name="articleId" value={article.id} />
                <Button type="submit" variant="outline">
                  Cancel schedule
                </Button>
              </form>
            </div>
          ) : (
            <form action={scheduleArticleAction} style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="articleId" value={article.id} />
              <input type="datetime-local" name="scheduledAt" required disabled={!canPublish} />
              <Button type="submit" variant="outline" disabled={!canPublish} title={publishDisabledReason}>
                Schedule
              </Button>
            </form>
          )}
        </Card>
      )}

      <Card style={{ padding: "22px" }}>
        <ArticleEditorClient
          articleId={article.id}
          initialTitle={article.title}
          initialBody={article.body}
          initialExcerpt={article.excerpt ?? ""}
          initialTags={article.tags.join(", ")}
          initialTopic={article.topic ?? ""}
          initialPreviewHtml={preview}
        />
      </Card>

      <Card style={{ padding: "18px 20px" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Article URL</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--ink-faint)" }}>
          keenafricans.{rootDomain}/{authorUsername ?? "…"}/<strong>{article.slug}</strong>
          {article.status === "published" && " — changing this after publishing keeps the old link working (it redirects here)."}
        </p>
        <form action={updateArticleSlugAction} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input type="hidden" name="articleId" value={article.id} />
          <Input name="slug" defaultValue={article.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" style={{ flex: 1 }} />
          <Button type="submit" variant="outline">
            Update URL
          </Button>
        </form>
      </Card>

      <Card style={{ padding: "22px" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Cover image</h3>
        {article.coverAssetId && (
          <div style={{ marginBottom: "12px" }}>
            <img
              src={`/assets/${article.coverAssetId}/download`}
              alt=""
              style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, display: "block", marginBottom: 10 }}
            />
            <form action={removeCoverImageAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" variant="outline">
                Remove cover
              </Button>
            </form>
          </div>
        )}
        <form action={setCoverImageAction} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input type="hidden" name="articleId" value={article.id} />
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
          <Button type="submit" variant="outline">
            Upload cover
          </Button>
        </form>
      </Card>
    </div>
  );
}
