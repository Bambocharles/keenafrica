import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { deriveExcerpt, listPublishedArticles } from "@/lib/articles";
import { LegalFooter } from "./LegalFooter";
import styles from "./site.module.css";

export const metadata = {
  title: "Keen Africans",
  description: "Articles from Keen Africans — Keen Africa's community of writers.",
};

export default async function KeenAfricansHomePage({
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
                {a.publishedAt && ` · ${new Date(a.publishedAt).toLocaleDateString()}`}
              </p>
              <p className={styles.cardExcerpt}>{a.excerpt || deriveExcerpt(a.body)}</p>
            </a>
          ))}
        </div>
      )}

      {total > pageSize && (
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          {Number(page ?? 1) > 1 && <a href={`/?page=${Number(page ?? 1) - 1}`}>← Newer</a>}
          {Number(page ?? 1) * pageSize < total && <a href={`/?page=${Number(page ?? 1) + 1}`}>Older →</a>}
        </div>
      )}

      <LegalFooter />
    </div>
  );
}
