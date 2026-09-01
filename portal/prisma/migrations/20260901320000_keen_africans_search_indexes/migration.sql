-- Session 44 (Discovery, Search & Recommendations). Basic Postgres
-- full-text search over articles (title/excerpt/tags/body) and authors
-- (display name/username/profession/bio) — per this session's own explicit
-- "a simple database-backed search is enough, do not stand up a separate
-- search vendor" rule. See src/lib/search.ts for the queries these indexes
-- back (searchArticles()/searchAuthors()).
--
-- Deliberately NOT represented as columns/indexes in schema.prisma:
-- Prisma's schema DSL has no way to express a GIN index over a functional
-- (to_tsvector(...)) expression, so — same as every RLS policy in this
-- codebase — this lives only in the raw migration SQL. `prisma migrate
-- diff` will therefore always report these two indexes as "drift" against
-- schema.prisma; that's expected and matches this codebase's existing,
-- already-documented RLS-drift convention, not a bug.
--
-- Both use the two-argument to_tsvector(regconfig, text) form (a fixed
-- 'english' literal, not a column), which is PostgreSQL's own documented
-- pattern for an indexable full-text expression
-- (https://www.postgresql.org/docs/current/textsearch-tables.html).
--
-- `tags` is deliberately NOT folded into this expression: array_to_string()
-- is STABLE, not IMMUTABLE (locale-dependent element formatting), and
-- Postgres refuses to index a non-immutable expression at all ("functions
-- in index expression must be marked IMMUTABLE" — confirmed against this
-- codebase's own Postgres). src/lib/search.ts's searchArticles() matches
-- tags with a separate, unindexed `tag = ANY(tags)` condition instead —
-- fine at this table's size; worth its own index (or a GIN index directly
-- on the `tags` array column, which IS indexable) if article volume ever
-- makes it a bottleneck (see docs/KEEN_AFRICANS.md's "Known limitations").
--
-- The articles index is PARTIAL (`WHERE status = 'published'`) — search
-- must never surface a draft (this session's own explicit "Must NOT" rule)
-- and a partial index keeps the index itself small and fast as the
-- overwhelming majority of read traffic only ever needs the published
-- subset; searchArticles() also applies `WHERE status = 'published'`
-- explicitly in the query itself (defense in depth, same as every other
-- public read in this codebase — RLS's own articles_select policy is the
-- actual backstop, this index is purely a performance optimization on top
-- of it, not a security boundary of its own).
CREATE INDEX "articles_fts_idx" ON "articles"
  USING GIN (
    to_tsvector(
      'english',
      "title" || ' ' || coalesce("excerpt", '') || ' ' || "body"
    )
  )
  WHERE "status" = 'published';

-- profiles carries no draft/private state at all (profiles_select is
-- unconditionally open — see the keen_africans_profiles_core migration),
-- so this index is not partial.
CREATE INDEX "profiles_fts_idx" ON "profiles"
  USING GIN (
    to_tsvector(
      'english',
      "display_name" || ' ' || "username" || ' ' || coalesce("profession", '') || ' ' || coalesce("bio", '')
    )
  );
