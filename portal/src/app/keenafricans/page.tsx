import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { ARTICLE_TOPIC_LABELS, ARTICLE_TOPICS, getTopicCounts, listPublishedArticles, listTrendingArticles } from "@/lib/articles";
import { listPeopleToFollow } from "@/lib/follows";
import { LegalFooter } from "./LegalFooter";
import { SearchBox } from "./SearchBox";
import styles from "./site.module.css";

export const metadata = {
  title: "Keen Africans",
  description: "Discover articles and authors from Keen Africans — Keen Africa's community of writers.",
};

const TEASER_SIZE = 5;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

/**
 * Session 44 (Discovery, Search & Recommendations). The public homepage,
 * turned from Session 34's flat "latest articles" list into a real
 * discovery page — this session's mission, verbatim. Four sections, all
 * against real data:
 *
 *  - Trending: recent view-velocity, not lifetime views (listTrendingArticles()).
 *  - Latest: newest published, unchanged data source, moved to /latest for
 *    its full paginated/tag-filterable form — this section is just a
 *    teaser linking there.
 *  - Topics: Session 38's curated ArticleTopic list, with live counts.
 *  - People to follow: most-followed authors the viewer doesn't already
 *    follow (listPeopleToFollow()) — omitted entirely for a signed-out
 *    visitor, since "doesn't already follow" has no meaning without a
 *    viewer identity and a sign-in prompt here would be a distraction from
 *    the rest of the page.
 *
 * Every read here is public/anonymous — no permission key, same as every
 * other public Keen Africans page.
 */
export default async function ExplorePage() {
  const session = await auth();
  const signedIn = canAccessKeenAfricanPortal(session?.user);

  const [trending, latest, topicCounts, peopleToFollow] = await Promise.all([
    listTrendingArticles(TEASER_SIZE),
    listPublishedArticles({ page: 1, topic: undefined }),
    getTopicCounts(),
    session?.user ? listPeopleToFollow(session.user.id, TEASER_SIZE) : Promise.resolve([]),
  ]);
  const latestTeaser = latest.articles.slice(0, TEASER_SIZE);

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

      {trending.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.listTitle}>Trending</p>
          </div>
          {trending.map((a) => (
            <a key={a.id} href={a.author.username ? `/${a.author.username}/${a.slug}` : `/articles/${a.slug}`} className={styles.smallCard}>
              <h2 className={styles.smallCardTitle}>{a.title}</h2>
              <p className={styles.smallCardMeta}>
                {a.author.name}
                {a.author.username && ` · @${a.author.username}`} · {a.viewsInWindow}{" "}
                {a.viewsInWindow === 1 ? "view" : "views"} in the last 48h
              </p>
            </a>
          ))}
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.listTitle}>Latest</p>
          <a href="/latest" className={styles.sectionLink}>
            See all &rarr;
          </a>
        </div>
        {latestTeaser.length === 0 ? (
          <div className={styles.empty}>No articles published yet.</div>
        ) : (
          latestTeaser.map((a) => (
            <a key={a.id} href={a.author.username ? `/${a.author.username}/${a.slug}` : `/articles/${a.slug}`} className={styles.smallCard}>
              <h2 className={styles.smallCardTitle}>{a.title}</h2>
              <p className={styles.smallCardMeta}>
                {a.author.name}
                {a.author.username && ` · @${a.author.username}`}
                {a.publishedAt && ` · ${new Date(a.publishedAt).toLocaleDateString()}`}
              </p>
            </a>
          ))
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.listTitle}>Topics</p>
        </div>
        <div className={styles.topicGrid}>
          {ARTICLE_TOPICS.map((topic) => (
            <a key={topic} href={`/topics/${topic}`} className={styles.topicPill}>
              {ARTICLE_TOPIC_LABELS[topic]} <span className={styles.topicPillCount}>{topicCounts[topic]}</span>
            </a>
          ))}
        </div>
      </section>

      {peopleToFollow.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <p className={styles.listTitle}>People to follow</p>
          </div>
          <div className={styles.peopleGrid}>
            {peopleToFollow.map((p) => (
              <a key={p.userId} href={`/u/${p.username}`} className={styles.personCard}>
                {p.avatarAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/avatars/${p.avatarAssetId}`} alt="" className={styles.personAvatar} />
                ) : (
                  <div className={styles.personAvatarInitials} aria-hidden>
                    {initials(p.displayName)}
                  </div>
                )}
                <div className={styles.personInfo}>
                  <span className={styles.personName}>{p.displayName}</span>
                  <p className={styles.personMeta}>
                    {p.followerCount} {p.followerCount === 1 ? "follower" : "followers"} · {p.articleCount}{" "}
                    {p.articleCount === 1 ? "article" : "articles"}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <LegalFooter />
    </div>
  );
}
