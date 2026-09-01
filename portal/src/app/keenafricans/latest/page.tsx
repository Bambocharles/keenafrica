import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { deriveExcerpt, listPublishedArticles } from "@/lib/articles";
import { LegalFooter } from "../LegalFooter";
import { SearchBox } from "../SearchBox";
import styles from "../site.module.css";

export const metadata = {
  title: "Latest — Keen Africans",
  description: "Every published article on Keen Africans, newest first.",
};

/**
 * Session 44 (Discovery, Search & Recommendations). The full paginated/
 * tag-filterable listing Session 34's original homepage (`/`) used to be —
 * moved here unchanged (same listPublishedArticles() call, same pagination,
 * same `?tag=` filter every article-tag link on the site already points
 * at) once `/` itself became the Explore page. Nothing about this page's
 * own behavior changed, only its URL.
 */
export default async function LatestArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tag?: string }>;
}) {
  const session = await auth();
  const { page, tag } = await searchParams;
  const { articles, total, pageSize } = await listPublishedArticles({
    page: page ? Number(page) : 1,
    tag,
  });

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
        {tag ? `Tagged "${tag}"` : "Latest articles"} &middot; {total}
      </p>

      {articles.length === 0 ? (
        <div className={styles.empty}>No articles published yet.</div>
      ) : (
        <div>
          {articles.map((a) => (
            <a key={a.id} href={`/articles/${a.slug}`} className={styles.card}>
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
          {Number(page ?? 1) > 1 && <a href={`/latest?page=${Number(page ?? 1) - 1}${tag ? `&tag=${tag}` : ""}`}>← Newer</a>}
          {Number(page ?? 1) * pageSize < total && (
            <a href={`/latest?page=${Number(page ?? 1) + 1}${tag ? `&tag=${tag}` : ""}`}>Older →</a>
          )}
        </div>
      )}

      <LegalFooter />
    </div>
  );
}
