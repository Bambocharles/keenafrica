import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { searchArticles, searchAuthors } from "@/lib/search";
import { LegalFooter } from "../LegalFooter";
import { SearchBox } from "../SearchBox";
import styles from "../site.module.css";

export const metadata: Metadata = { title: "Search — Keen Africans" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

/**
 * Session 44 (Discovery, Search & Recommendations). Search results across
 * both articles and authors for one query — src/lib/search.ts's
 * searchArticles()/searchAuthors() are the actual security boundary (never
 * drafts, never private profile fields); this page only renders whatever
 * they return.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await auth();
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const signedIn = canAccessKeenAfricanPortal(session?.user);

  const [articles, authors] = query
    ? await Promise.all([searchArticles(query), searchAuthors(query)])
    : [[], []];

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

      <SearchBox defaultValue={query} />

      {!query ? (
        <div className={styles.empty}>Search for an article or an author.</div>
      ) : articles.length === 0 && authors.length === 0 ? (
        <div className={styles.empty}>No results for &ldquo;{query}&rdquo;.</div>
      ) : (
        <>
          {authors.length > 0 && (
            <>
              <p className={styles.searchResultKind}>Authors</p>
              <div className={styles.peopleGrid}>
                {authors.map((a) => (
                  <a key={a.userId} href={`/u/${a.username}`} className={styles.personCard}>
                    {a.avatarAssetId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/avatars/${a.avatarAssetId}`} alt="" className={styles.personAvatar} />
                    ) : (
                      <div className={styles.personAvatarInitials} aria-hidden>
                        {initials(a.displayName)}
                      </div>
                    )}
                    <div className={styles.personInfo}>
                      <span className={styles.personName}>{a.displayName}</span>
                      {a.profession && <p className={styles.personMeta}>{a.profession}</p>}
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}

          {articles.length > 0 && (
            <>
              <p className={styles.searchResultKind}>Articles</p>
              <div>
                {articles.map((a) => (
                  <a key={a.id} href={a.author.username ? `/${a.author.username}/${a.slug}` : `/articles/${a.slug}`} className={styles.card}>
                    <h2 className={styles.cardTitle}>{a.title}</h2>
                    <p className={styles.cardMeta}>
                      {a.author.name}
                      {a.author.username && ` · @${a.author.username}`}
                      {a.publishedAt && ` · ${new Date(a.publishedAt).toLocaleDateString()}`}
                    </p>
                    {a.excerpt && <p className={styles.cardExcerpt}>{a.excerpt}</p>}
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <LegalFooter />
    </div>
  );
}
