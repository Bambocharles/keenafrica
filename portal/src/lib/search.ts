import { withRls } from "@/lib/rls";
import { getMemberLabelUserIds, getUsernamesByUserIds } from "@/lib/profiles";
import { getVerifiedUserIds } from "@/lib/verification";

/**
 * Discovery, Search & Recommendations (Session 44). Basic Postgres
 * full-text search across articles (title/excerpt/tags/body) and authors
 * (display name/username/profession/bio) — per this session's own explicit
 * "a simple database-backed search is enough, do not stand up a separate
 * search vendor" rule. Backed by the two GIN indexes the
 * keen_africans_search_indexes migration adds (see that migration's own
 * comment for why `tags` is matched separately rather than folded into the
 * indexed expression).
 *
 * Both queries re-apply their own visibility rule directly in SQL (never
 * delegate to RLS alone) — same "defense in depth" standard every other
 * public read in this codebase meets: searchArticles() only ever selects
 * `status = 'published'` rows (RLS's own articles_select policy is the
 * actual backstop; this is the belt on top of that suspenders), and
 * searchAuthors() only ever reads the Profile table, which carries no
 * draft/private state to filter at all (profiles_select is unconditionally
 * open — see the keen_africans_profiles_core migration).
 */

const MAX_SEARCH_LIMIT = 50;

export interface ArticleSearchHit {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  tags: string[];
  topic: string | null;
  publishedAt: Date | null;
  authorId: string;
  author: { name: string; username: string | null; member: boolean; verified: boolean };
}

interface ArticleSearchRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  tags: string[];
  topic: string | null;
  published_at: Date | null;
  author_id: string;
  author_name: string;
  rank: number;
}

/**
 * `plainto_tsquery` is word/stem-based (matches "cloud" against "clouds,"
 * not a partial "clou"), so a plain `title ILIKE` fallback is OR'd in for
 * short/partial queries — a small, deliberate addition to a still-simple
 * v1, not a second search engine. Tags are matched directly against the
 * array (`= ANY(tags)`), not through the tsvector index — see the
 * keen_africans_search_indexes migration's own comment for why.
 */
export async function searchArticles(query: string, limit = 20): Promise<ArticleSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const take = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);
  const likePattern = `%${q}%`;

  const rows = await withRls({}, (tx) =>
    tx.$queryRaw<ArticleSearchRow[]>`
      SELECT
        id, slug, title, excerpt, tags, topic, published_at, author_id, author_name,
        ts_rank(
          to_tsvector('english', title || ' ' || coalesce(excerpt, '') || ' ' || body),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM articles
      WHERE status = 'published'
        AND (
          to_tsvector('english', title || ' ' || coalesce(excerpt, '') || ' ' || body)
            @@ plainto_tsquery('english', ${q})
          OR title ILIKE ${likePattern}
          OR ${q.toLowerCase()} = ANY(tags)
        )
      ORDER BY rank DESC, published_at DESC
      LIMIT ${take}
    `
  );
  if (rows.length === 0) return [];

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const [usernames, memberIds, verifiedIds] = await Promise.all([
    getUsernamesByUserIds(authorIds),
    getMemberLabelUserIds(authorIds),
    getVerifiedUserIds(authorIds),
  ]);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    tags: r.tags,
    topic: r.topic,
    publishedAt: r.published_at,
    authorId: r.author_id,
    author: {
      name: r.author_name,
      username: usernames.get(r.author_id) ?? null,
      member: memberIds.has(r.author_id),
      verified: verifiedIds.has(r.author_id),
    },
  }));
}

export interface AuthorSearchHit {
  userId: string;
  username: string;
  displayName: string;
  profession: string | null;
  avatarAssetId: string | null;
  verified: boolean;
}

interface AuthorSearchRow {
  user_id: string;
  username: string;
  display_name: string;
  profession: string | null;
  avatar_asset_id: string | null;
  rank: number;
}

export async function searchAuthors(query: string, limit = 20): Promise<AuthorSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const take = Math.min(Math.max(1, limit), MAX_SEARCH_LIMIT);
  const likePattern = `%${q}%`;

  const rows = await withRls({}, (tx) =>
    tx.$queryRaw<AuthorSearchRow[]>`
      SELECT
        user_id, username, display_name, profession, avatar_asset_id,
        ts_rank(
          to_tsvector('english', display_name || ' ' || username || ' ' || coalesce(profession, '') || ' ' || coalesce(bio, '')),
          plainto_tsquery('english', ${q})
        ) AS rank
      FROM profiles
      WHERE
        to_tsvector('english', display_name || ' ' || username || ' ' || coalesce(profession, '') || ' ' || coalesce(bio, ''))
          @@ plainto_tsquery('english', ${q})
        OR display_name ILIKE ${likePattern}
        OR username ILIKE ${likePattern}
      ORDER BY rank DESC, display_name ASC
      LIMIT ${take}
    `
  );
  if (rows.length === 0) return [];

  const verifiedIds = await getVerifiedUserIds(rows.map((r) => r.user_id));

  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    profession: r.profession,
    avatarAssetId: r.avatar_asset_id,
    verified: verifiedIds.has(r.user_id),
  }));
}
