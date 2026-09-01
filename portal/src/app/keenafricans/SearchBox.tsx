import styles from "./site.module.css";

/**
 * Session 44 (Discovery, Search & Recommendations). A plain GET `<form>` —
 * no client JS, same "server-rendered, no hydration needed" convention
 * every other public form on this site (ReportForm, FollowButton, ...)
 * follows. Submits straight to /search?q=... — the query itself is just a
 * URL param, so this needs no Server Action.
 */
export function SearchBox({ defaultValue }: { defaultValue?: string }) {
  return (
    <form action="/search" method="get" className={styles.searchBox}>
      <input
        type="search"
        name="q"
        placeholder="Search articles and authors…"
        defaultValue={defaultValue}
        className={styles.searchInput}
        aria-label="Search Keen Africans"
      />
      <button type="submit" className={styles.searchSubmit}>
        Search
      </button>
    </form>
  );
}
