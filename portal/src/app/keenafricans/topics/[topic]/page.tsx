import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ArticleTopic } from "@prisma/client";
import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { ARTICLE_TOPICS, ARTICLE_TOPIC_LABELS, deriveExcerpt, listPublishedArticles } from "@/lib/articles";
import { LegalFooter } from "../../LegalFooter";
import { SearchBox } from "../../SearchBox";
import styles from "../../site.module.css";

/**
 * Session 44 (Discovery, Search & Recommendations). Topic browsing — one
 * page per Session 38's curated ArticleTopic value, same pagination shape
 * as /latest but filtered by `topic` instead of `tag`. `[topic]` is
 * validated against ARTICLE_TOPICS (not passed straight to the DB query as
 * a free string) since it flows into an enum-typed Prisma filter — an
 * unrecognized segment 404s rather than erroring.
 */
function parseTopic(raw: string): ArticleTopic | null {
  return (ARTICLE_TOPICS as string[]).includes(raw) ? (raw as ArticleTopic) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const topic = parseTopic((await params).topic);
  if (!topic) return {};
  const label = ARTICLE_TOPIC_LABELS[topic];
  return { title: `${label} — Keen Africans`, description: `Articles about ${label} on Keen Africans.` };
}

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ topic: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const topic = parseTopic((await params).topic);
  if (!topic) notFound();

  const session = await auth();
  const { page } = await searchParams;
  const { articles, total, pageSize } = await listPublishedArticles({ page: page ? Number(page) : 1, topic });
  const signedIn = canAccessKeenAfricanPortal(session?.user);

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

      <SearchBox />

      <p className={styles.listTitle}>
        {ARTICLE_TOPIC_LABELS[topic]} &middot; {total}
      </p>

      {articles.length === 0 ? (
        <div className={styles.empty}>No published articles in this topic yet.</div>
      ) : (
        <div>
          {articles.map((a) => (
            <a key={a.id} href={a.author.username ? `/${a.author.username}/${a.slug}` : `/articles/${a.slug}`} className={styles.card}>
              <h2 className={styles.cardTitle}>{a.title}</h2>
              <p className={styles.cardMeta}>
                {a.author.name}
                {a.author.username && ` · @${a.author.username}`}
                {a.publishedAt && ` · ${new Date(a.publishedAt).toLocaleDateString()}`}
              </p>
              <p className={styles.cardExcerpt}>{a.excerpt || deriveExcerpt(a.body)}</p>
            </a>
          ))}
        </div>
      )}

      {total > pageSize && (
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          {Number(page ?? 1) > 1 && <a href={`/topics/${topic}?page=${Number(page ?? 1) - 1}`}>← Newer</a>}
          {Number(page ?? 1) * pageSize < total && (
            <a href={`/topics/${topic}?page=${Number(page ?? 1) + 1}`}>Older →</a>
          )}
        </div>
      )}

      <LegalFooter />
    </div>
  );
}
