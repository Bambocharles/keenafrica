import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, canAccessKeenAfricanPortal, hasPermission } from "@/lib/authz";
import { ARTICLE_TOPIC_LABELS, deriveExcerpt, getPublicArticleBySlug, hashViewerKey, recordArticleView, renderArticleBodyHtml, resolveRedirectSlug } from "@/lib/articles";
import { isFollowing } from "@/lib/follows";
import { listCommentsForArticle } from "@/lib/comments";
import { getReactionCount, hasReacted } from "@/lib/reactions";
import { ShareLinks } from "./ShareLinks";
import { LegalFooter } from "../../LegalFooter";
import { VerificationBadge } from "../../VerificationBadge";
import { ReportForm } from "../../ReportForm";
import { FollowButton } from "../../FollowButton";
import { ReactionButton } from "../../ReactionButton";
import { CommentSection } from "../../CommentSection";
import styles from "../../site.module.css";

/**
 * The public article-reading page — keenafricans.<root>/<username>/<slug>.
 * Follow-up to Session 36: the canonical article URL now carries the
 * author's username (matching the real precedent for a SHARED,
 * multi-author platform — e.g. dev.to/<username>/<slug> — as opposed to a
 * single-author personal blog, where the domain itself already carries
 * the author's identity and no path segment is needed). The old
 * `/articles/<slug>` shape (../../articles/[id]/page.tsx) is now a
 * permanent redirect shim into this route, so every already-shared link
 * keeps working.
 *
 * The username segment is deliberately NOT the lookup key — slug alone
 * (globally unique, unchanged) is. This is what makes the scheme
 * self-healing against two things with no new schema needed:
 *   1. A renamed article slug (already handled by resolveRedirectSlug(),
 *      same as before this follow-up).
 *   2. A renamed username — Profile.username is mutable at any time via
 *      updateProfile(), with no history/redirect tracking of its own
 *      (unlike Article.previousSlugs). A stale/wrong username segment in
 *      the URL just gets corrected via a permanent redirect to the
 *      article's real, current author/slug — never a 404, and never
 *      cross-author leakage, since slug uniqueness is global (a stale
 *      username paired with a real slug can only ever resolve to the one
 *      article that actually owns that slug).
 */
async function loadArticle(usernameParam: string, slugParam: string) {
  let article = await getPublicArticleBySlug(slugParam);

  if (!article) {
    const currentSlug = await resolveRedirectSlug(slugParam);
    if (!currentSlug) notFound();
    article = await getPublicArticleBySlug(currentSlug);
    if (!article) notFound();
  }

  // Defensive: an author with no profile row yet (should never happen in
  // practice — ensureProfile() runs on every protected page load before
  // an article could ever be created) has no username to redirect into.
  // Render inline rather than redirecting into a broken `/null/<slug>` URL.
  const canonicalUsername = article.author.username;
  if (canonicalUsername && (canonicalUsername !== usernameParam || article.slug !== slugParam)) {
    permanentRedirect(`/${canonicalUsername}/${article.slug}`);
  }

  return article;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublicArticleBySlug(slug);
  if (!article) return {};

  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
  const description = article.excerpt || deriveExcerpt(article.body);
  const ogImage = article.coverAssetId ? [`https://keenafricans.${rootDomain}/covers/${article.coverAssetId}`] : undefined;

  return {
    title: `${article.title} — Keen Africans`,
    description,
    openGraph: {
      type: "article",
      title: article.title,
      description,
      images: ogImage,
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: article.title,
      description,
    },
  };
}

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; slug: string }>;
  searchParams: Promise<{
    reported?: string;
    reportedEntityId?: string;
    reportError?: string;
    reportErrorEntityId?: string;
    followError?: string;
    commentError?: string;
    commentDeleteError?: string;
    reactionError?: string;
  }>;
}) {
  const { username, slug } = await params;
  const article = await loadArticle(username, slug);
  const session = await auth();
  const signedIn = canAccessKeenAfricanPortal(session?.user);
  const {
    reported,
    reportedEntityId,
    reportError,
    reportErrorEntityId,
    followError,
    commentError,
    commentDeleteError,
    reactionError,
  } = await searchParams;

  // Session 42 (Follow & Author Reputation Display). Exactly one call per
  // real render, from the page body only — never from generateMetadata()
  // above, which would double-count a single visit (see recordArticleView()'s
  // own comment). Fire against the article's real id, not the slug.
  //
  // Session 44 (Discovery, Search & Recommendations). Passes a dedup key —
  // the signed-in viewer's own id, or a salted hash of IP+User-Agent for an
  // anonymous reader — so a rapid page refresh doesn't inflate the count;
  // see hashViewerKey()/recordArticleView()'s own comments.
  const h = await headers();
  await recordArticleView(
    article.id,
    hashViewerKey({
      userId: session?.user?.id,
      ipAddress: h.get("x-forwarded-for"),
      userAgent: h.get("user-agent"),
    })
  );
  const [viewerFollowingAuthor, comments, reactionCount, viewerReacted] = await Promise.all([
    isFollowing(session?.user?.id, article.authorId),
    listCommentsForArticle(article.id),
    getReactionCount(article.id),
    hasReacted(session?.user?.id, article.id),
  ]);
  const canManageComments = !!session?.user && (session.user.isSuperAdmin || hasPermission(session.user, PERMISSIONS.ARTICLES_MANAGE));

  const html = renderArticleBodyHtml(article.body);
  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
  const authorUsername = article.author.username ?? username;
  const articlePath = `/${authorUsername}/${article.slug}`;
  const articleUrl = `https://keenafricans.${rootDomain}${articlePath}`;

  return (
    <div className={styles.wrap}>
      <header className={styles.masthead}>
        <a href="/" className={styles.wordmark}>
          <span className={styles.mark}>K</span>
          Keen Africans
        </a>
        <a href={signedIn ? "/dashboard" : "/register"} className={styles.cta}>
          {signedIn ? "My dashboard" : "Write on Keen Africans"}
        </a>
      </header>

      <article className={styles.article}>
        <header className={styles.top}>
          {(article.topic || article.tags.length > 0) && (
            <p className={styles.kicker}>
              {[article.topic ? ARTICLE_TOPIC_LABELS[article.topic] : null, ...article.tags].filter(Boolean).join(" · ")}
            </p>
          )}
          <h1>{article.title}</h1>
          <div className={styles.byline}>
            {article.author.username ? (
              <a href={`/u/${article.author.username}`}>{article.author.name}</a>
            ) : (
              <span>{article.author.name}</span>
            )}
            <VerificationBadge member={article.author.member} verified={article.author.verified} />
            {article.publishedAt && <time dateTime={article.publishedAt.toISOString()}>{new Date(article.publishedAt).toLocaleDateString()}</time>}
            <FollowButton
              targetUserId={article.authorId}
              isSelf={session?.user?.id === article.authorId}
              signedIn={!!session?.user}
              following={viewerFollowingAuthor}
              returnTo={articlePath}
              followError={followError}
            />
            <ReactionButton
              articleId={article.id}
              signedIn={!!session?.user}
              reacted={viewerReacted}
              count={reactionCount}
              returnTo={articlePath}
              reactionError={reactionError}
            />
          </div>
          <ShareLinks url={articleUrl} title={article.title} />
        </header>

        {article.coverAssetId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/covers/${article.coverAssetId}`} alt="" className={styles.cover} />
        )}

        <div className={styles.body} dangerouslySetInnerHTML={{ __html: html }} />

        <footer className={styles.articleFoot}>
          {article.tags.length > 0 && (
            <div className={styles.tags}>
              {article.tags.map((t) => (
                <a key={t} href={`/latest?tag=${encodeURIComponent(t)}`} className={styles.tag}>
                  #{t}
                </a>
              ))}
            </div>
          )}
          <ShareLinks url={articleUrl} title={article.title} />
          <ReportForm
            entityType="article"
            entityId={article.id}
            returnTo={articlePath}
            reported={reported === "1" && reportedEntityId === article.id}
            reportError={reportErrorEntityId === article.id ? reportError : undefined}
          />
        </footer>

        <CommentSection
          articleId={article.id}
          articleAuthorId={article.authorId}
          comments={comments}
          viewerId={session?.user?.id}
          signedIn={!!session?.user}
          canManage={canManageComments}
          returnTo={articlePath}
          commentError={commentError}
          commentDeleteError={commentDeleteError}
          reportedEntityId={reportedEntityId}
          reportErrorEntityId={reportErrorEntityId}
          reportError={reportError}
        />
      </article>

      <LegalFooter />
    </div>
  );
}
