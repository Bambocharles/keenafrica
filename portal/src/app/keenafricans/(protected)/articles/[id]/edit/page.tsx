import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getArticleForEdit, renderArticleBodyHtml, ArticleNotFoundError } from "@/lib/articles";
import { AuthorizationError } from "@/lib/authz";
import { isEmailVerified } from "@/lib/email-verification";
import { Banner, Button, Card, Field, Input, StatusBadge } from "@/components/ui";
import ui from "@/components/ui/styles.module.css";
import {
  archiveArticleAction,
  publishArticleAction,
  removeCoverImageAction,
  setCoverImageAction,
  unpublishArticleAction,
  updateArticleAction,
} from "../../actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: "Title is required.",
  email_not_verified: "Verify your email before publishing — see your dashboard.",
  not_authorized: "You can only edit your own articles.",
  not_found: "That article no longer exists.",
  unsupported_file_type: "That file type isn't supported for a cover image.",
  file_too_large: "That file is too large.",
  action_failed: "Something went wrong.",
};

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

  const [verified, rootDomain] = [await isEmailVerified(user.id), process.env.ROOT_DOMAIN ?? "keenafrica.com"];
  const preview = article.body ? renderArticleBodyHtml(article.body) : "";

  return (
    <div style={{ display: "grid", gap: "20px", maxWidth: 760 }}>
      {error && <Banner>{ERROR_MESSAGES[error] ?? "Something went wrong."}</Banner>}
      {saved && !error && <Banner variant="success">Saved.</Banner>}

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <StatusBadge status={article.status} />
        {article.status === "published" && (
          <a href={`https://keenafricans.${rootDomain}/articles/${article.slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            View live ↗
          </a>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          {article.status !== "published" && (
            <form action={publishArticleAction}>
              <input type="hidden" name="articleId" value={article.id} />
              <Button type="submit" disabled={!verified} title={!verified ? "Verify your email to publish" : undefined}>
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

      <Card style={{ padding: "22px" }}>
        <form action={updateArticleAction} style={{ display: "grid", gap: "14px" }}>
          <input type="hidden" name="articleId" value={article.id} />
          <Field label="Title">
            <Input name="title" defaultValue={article.title} required />
          </Field>
          <Field label="Meta description (for search engines and link previews)">
            <Input name="excerpt" defaultValue={article.excerpt ?? ""} maxLength={300} />
          </Field>
          <Field label="Tags (comma-separated)">
            <Input name="tags" defaultValue={article.tags.join(", ")} placeholder="azure, terraform, security" />
          </Field>
          <Field label="Body (Markdown)">
            <textarea
              name="body"
              defaultValue={article.body}
              required
              rows={20}
              className={ui.input}
              style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            />
          </Field>
          <Button type="submit">Save</Button>
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

      {preview && (
        <Card style={{ padding: "22px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Preview (as last saved)</h3>
          <div className={ui.subCell} dangerouslySetInnerHTML={{ __html: preview }} />
        </Card>
      )}
    </div>
  );
}
