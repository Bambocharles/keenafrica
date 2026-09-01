import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PERMISSIONS, canAccessKeenAfricanPortal, hasPermission } from "@/lib/authz";
import { ARTICLE_TOPIC_LABELS, deriveExcerpt, getPublicArticleBySlug, recordArticleView, renderArticleBodyHtml, resolveRedirectSlug } from "@/lib/articles";
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
 * Session 38 (Keen Africans — Editor Workflow). If `slug` was this
 * article's URL before an author edited it (updateArticleSlug()), send
 * readers/search engines to the current URL instead of 404ing — see
 * schema.prisma's Article.previousSlugs comment. A slug that was never
 * used at all still 404s.
 */
async function loadArticle(slug: string) {
  const article = await getPublicArticleBySlug(slug);
  if (article) return article;

  const currentSlug = await resolveRedirectSlug(slug);
  if (currentSlug) redirect(`/articles/${currentSlug}`);

  notFound();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // The route segment is named [id] (not [slug]) purely because Next.js
  // requires one consistent dynamic-segment name per URL position across
  // the whole app dir, including across route groups — this position also
  // resolves .../articles/[id]/edit under the (protected) group. The value
  // itself is still the article's slug, not its UUID id.
  const slug = (await params).id;
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
  params: Promise<{ id: string }>;
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
  const slug = (await params).id;
  const article = await loadArticle(slug);
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
  await recordArticleView(article.id);
  const [viewerFollowingAuthor, comments, reactionCount, viewerReacted] = await Promise.all([
    isFollowing(session?.user?.id, article.authorId),
    listCommentsForArticle(article.id),
    getReactionCount(article.id),
    hasReacted(session?.user?.id, article.id),
  ]);
  const canManageComments = !!session?.user && (session.user.isSuperAdmin || hasPermission(session.user, PERMISSIONS.ARTICLES_MANAGE));

  const html = renderArticleBodyHtml(article.body);
  const rootDomain = process.env.ROOT_DOMAIN ?? "keenafrica.com";
  const articleUrl = `https://keenafricans.${rootDomain}/articles/${article.slug}`;

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
              returnTo={`/articles/${article.slug}`}
              followError={followError}
            />
            <ReactionButton
              articleId={article.id}
              signedIn={!!session?.user}
              reacted={viewerReacted}
              count={reactionCount}
              returnTo={`/articles/${article.slug}`}
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
                <a key={t} href={`/?tag=${encodeURIComponent(t)}`} className={styles.tag}>
                  #{t}
                </a>
              ))}
            </div>
          )}
          <ShareLinks url={articleUrl} title={article.title} />
          <ReportForm
            entityType="article"
            entityId={article.id}
            returnTo={`/articles/${article.slug}`}
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
          returnTo={`/articles/${article.slug}`}
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
