import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { ARTICLE_TOPIC_LABELS, deriveExcerpt, getPublicArticleBySlug, renderArticleBodyHtml, resolveRedirectSlug } from "@/lib/articles";
import { ShareLinks } from "./ShareLinks";
import { LegalFooter } from "../../LegalFooter";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const slug = (await params).id;
  const article = await loadArticle(slug);
  const session = await auth();
  const signedIn = canAccessKeenAfricanPortal(session?.user);

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
            {/* Verification badge slot — deliberately empty, Session 40's territory. */}
            <span data-verification-badge-slot aria-hidden />
            {article.publishedAt && <time dateTime={article.publishedAt.toISOString()}>{new Date(article.publishedAt).toLocaleDateString()}</time>}
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
        </footer>
      </article>

      <LegalFooter />
    </div>
  );
}
