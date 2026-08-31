# Keen Africans (Session 34)

A self-serve publishing section, deliberately its own trust model from the
education platform: open self-registration, no approval gate, published
articles publicly readable with no login. Lives inside this same portal
Next.js app as a fourth reserved subdomain — `keenafricans.<root>` —
routed by `src/middleware.ts` exactly like `admin`/`teacher`/`student`/
`sponsor` already are (`src/app/keenafricans/**`). Reuses the canonical
User/Session/RLS/Asset/audit/rate-limit infrastructure throughout; nothing
here is a parallel identity, file, or authorization system.

## Where it lives

`keenafricans.<root>`, e.g. `keenafricans.keenafrica.com` in production
(`keenafricans.portal.local` in local dev, matching `ROOT_DOMAIN`).
Session 35's homepage dropdown should point at this exact subdomain.

## The `KEEN_AFRICAN` role

Added to `src/lib/authz.ts`'s `ROLE_NAMES`/`PERMISSIONS`
(`articles.write`, `articles.manage`) and `DEFAULT_ROLE_PERMISSIONS`
(`KEEN_AFRICAN: [articles.write]`, ownership-scoped in practice — see
below). Granted automatically on registration through
`keenafricans.<root>/register`, the third value in `src/lib/registration.ts`'s
`REGISTERABLE_ROLES` (alongside `TEACHER`/`STUDENT`) — same "the subdomain
IS the platform-role choice" convention Session 18 established, reused
completely as-is (`registerUser`/`registerUserViaProvider`, both password
and Google sign-in via `src/lib/auth.ts`'s `subdomainSignupRole()`).
Deliberately **not** tied to Organization Core — an individual publishing
under their own name doesn't fit that shape, per the session brief's own
reasoning, confirmed against the real Organization Core code.

`articles.manage` is the moderation key (ADMIN/SUPER_ADMIN, via
`ALL_PERMISSION_KEYS` — no `KEEN_AFRICAN`/`TEACHER`/`STUDENT` role holds
it).

## The `Article` entity

`prisma/schema.prisma`'s `Article`: `id`, `authorId`, `title`, `slug`
(globally unique, the public URL), `body` (Markdown — never raw HTML),
`excerpt`, `tags` (`String[]`), `status` (reuses the existing
`ContentStatus` enum — `draft` → `published` → `archived`, the same type
`Module`/`Lesson` already use, not a new status type), `coverAssetId` (FK
to the existing `Asset` table), `publishedAt`, and
`moderatedAt`/`moderatedBy`/`moderationNote` (set only by the admin
safety valve below).

Migrations, in order: `20260831150000_keen_africans_core` (adds
`users.email_verified_at` + `email_verification_tokens`),
`20260831160000_keen_africans_articles` (the `articles` table + its RLS),
`20260831170000_keen_africans_asset_entity_type` (adds the
`'article_cover'` `AssetEntityType` value — its own migration/transaction,
same Postgres enum-value restriction every prior `AssetEntityType`
addition hit), `20260831180000_keen_africans_asset_attachments` (extends
`asset_attachments_select`/`write`/`delete` with the `article_cover`
branch).

### Content security — the actual XSS decision

`body` is Markdown, rendered through **one shared path**,
`src/lib/articles.ts`'s `renderArticleBodyHtml()`: `marked` parses
Markdown to HTML, then `sanitize-html` re-parses that HTML against a
strict allowlist (headings/paragraphs/lists/tables/code/blockquote/a/img;
no `script`/`style`/`iframe`/`form`, no `on*` attributes, no
`javascript:`/`data:` URLs) and strips everything else. This is the one
template every Keen African's article renders through — there is no path
from an author's raw HTML into a served page. `deriveExcerpt()` produces a
plain-text fallback (meta description/OG) when an author leaves the
excerpt field empty. Covered directly by `articles.test.ts` (a raw
`<script>` tag embedded in Markdown source, `onerror=`, `javascript:` URLs
— all stripped) and live-verified against the real published founding
article (see "Verification" below).

## Abuse-model decisions (sessions/34's explicit item 3)

1. **Email verification before first publish: yes.** A self-registered
   account can sign in, draft, and preview immediately — only
   `publishArticle()`'s draft→published transition is gated on
   `users.email_verified_at`. `src/lib/email-verification.ts` mirrors
   `password-reset.ts` exactly (hashed, single-use, 24h TTL token; new
   `app.email_verification_lookup` RLS carve-out; delivered via the
   existing `src/lib/mailer.ts`). super_admin/`articles.manage` holders
   bypass the gate (so an admin can publish on someone's behalf if ever
   needed). Live-verified end-to-end (see below) — including that the
   *unverified* case is correctly refused (`EmailNotVerifiedError`).
2. **Admin/Troubleshooter unpublish safety valve: yes, audited.**
   `adminUnpublishArticle(articleId, actor, reason)` — `articles.manage`
   only, takes a published article back to `draft` (the author keeps it,
   can address the concern, and republish), records
   `moderatedAt`/`moderatedBy`/`moderationNote` on the row for the
   author's own dashboard, and writes an `article.unpublished_by_admin`
   `AuditEvent` with the reason. Reachable from the admin console at
   `/keen-africans` (`articles.manage`-gated nav item, same shape as
   `/flags`).
3. **Rate limiting: yes, reusing `src/lib/rate-limit.ts`.**
   `createArticle()` calls the existing `countRecentAuditEvents()` against
   the `article.created` action — 8 articles/hour/account, the same
   "generous, abuse-shaped not precision-shaped" threshold convention the
   login limiter uses. No new limiter mechanism.

## Ownership enforcement

Every mutation in `src/lib/articles.ts`
(`create`/`update`/`publish`/`unpublish`/`archive`/`setCoverImage`/
`removeCoverImage`) requires `articles.write` **and** `author_id` matching
the actor — application-layer (`requireArticleOwnerOrManage()`) **and**
independently at the RLS layer (`articles_write`/`articles_update`
policies, `keen_africans_articles` migration). Proven both ways: unit
tests assert `AuthorizationError` for a cross-author edit/archive attempt
(`articles.test.ts`), and `articles-rls.integration.test.ts` proves the
same thing against the real non-superuser `portal_rls_test` Postgres role
directly (an outsider cannot `UPDATE` another author's row even with a
crafted query, independent of what the application layer checks) — 10
RLS-layer cases, including that an anonymous caller (no `app.user_id` at
all) can read a published article and its cover image but never a draft
one's.

No article is ever hard-deleted — `archiveArticle()` is a status flip
(`archived`), same append-only-history convention as `assets`/
`certificates`; no `DELETE` RLS policy exists for `articles` at all.

## Cover images — Asset service reuse

`setCoverImage()`/`removeCoverImage()` go through the existing
`uploadAsset()`/`deleteAssetIfOrphanedAsContentOwner()` — no new storage
mechanism. An article's cover is a normal `AssetAttachment`
(`entityType: 'article_cover'`), and `src/lib/assets.ts`'s
`canAccessAssetAttachment()` gained the matching case (visible to whoever
can see the article itself), per that file's own documented extension
contract. Public serving is the one deliberate exception to "every asset
route requires a real `AuthzActor`" in this codebase:
`src/app/keenafricans/covers/[assetId]/route.ts` calls
`getPublicArticleCoverBytes()`, which runs under `withRls({})` (fully
anonymous) — safe specifically because the RLS policies already restrict
that anonymous read to exactly the cover of a *published* article. The
author's own authenticated in-progress preview (while still drafting) goes
through the normal protected `assets/[id]/download` route, same shape as
every other portal's.

## Pages

- `keenafricans.<root>/` — public listing, published articles only, no
  login (`getPublicArticleBySlug`/`listPublishedArticles`, both
  `withRls({})`).
- `keenafricans.<root>/articles/[id]` — public reading page (`[id]` is
  the route **segment name**, not the value — Next.js requires one
  consistent dynamic-segment name per URL position across the whole app
  dir, including across route groups, and this position also resolves
  `.../articles/[id]/edit` under `(protected)`; the actual value routed
  through is the article's **slug**). `generateMetadata()` sets
  title/description/OG image (`/covers/{coverAssetId}`) from the real
  extracted content.
- `/register`, `/login`, `/mfa` — mirror teacher/student's pages exactly;
  `/mfa` is a defense-in-depth stub (MFA policy covers `SUPER_ADMIN` only
  today, so a plain `KEEN_AFRICAN` account never actually reaches it).
- `/verify-email?token=...` — public, confirms the email-verification
  token.
- `(protected)/dashboard` — the author's own articles by status, a
  "resend verification" banner when unverified.
- `(protected)/articles/new`, `(protected)/articles/[id]/edit` — create/
  edit/publish/unpublish/archive, cover upload/remove, a static
  as-last-saved rendered preview.
- Admin: `/admin/(protected)/keen-africans` — the moderation safety
  valve's UI (`articles.manage`-gated).

## Verification

- `npm test`: 597/597 passing (564 baseline + 33 new — `articles.test.ts`,
  `email-verification.test.ts`, 10-case `articles-rls.integration.test.ts`),
  run against a real `RLS_TEST_DATABASE_URL`. `tsc --noEmit` clean.
- **Live, against a real running dev server, real HTTP** (no browser tool
  available in this sandbox — same `curl` + scraped `$ACTION_ID_...` +
  `multipart/form-data` technique Sessions 19/31/32 used): registered the
  site owner (`adebiyibanbo@gmail.com`) on `keenafricans.<root>/register`
  — real `registerUser()` call, real Auth.js session cookie issued, real
  `KEEN_AFRICAN` role row — landed on `/dashboard`, unverified banner
  shown. Confirmed the verification email in the mailer dev-stub log,
  fetched `/verify-email?token=...`, confirmed `email_verified_at` set.
  Then ran a one-time import script
  (`scripts/import-founding-article.ts`) that calls the **real**
  `createArticle`/`updateArticle`/`setCoverImage`/`publishArticle`
  functions (not a hand-copied HTML route) under that same registered
  account to author and publish the founding article. Confirmed live at
  `keenafricans.<root>/articles/the-build-agent-cannot-reach-the-database-
  that-is-the-point` with no cookie/session attached (200, correct
  title/meta description/OG image, exactly one `<h1>`, real `<pre><code>`
  blocks, no `<script>`/`onerror`/`javascript:` anywhere in the response),
  showing up on the public listing page, and the cover image publicly
  fetchable at `/covers/{assetId}` with no auth.

## Known limitations / deferred to v2

- **No comments, likes, or tags-as-navigation beyond a simple `?tag=`
  filter** on the listing page — explicitly out of scope for today per
  the session brief.
- **Moderation queue is a flat "every published article" list**, not a
  real flagged/reported queue with filters — the minimal safety valve the
  brief asks for, not a full moderation system.
- **No author profile/security pages** (change password, MFA enrollment)
  under `keenafricans.<root>` yet — an author can still do this by
  logging into any other portal with the same account if they ever need
  to (identity is shared across portals), but there's no dedicated UI
  here today.
- **Visual polish**: the shared template is a clean, editorial,
  dark-mode-aware design, not a pixel-for-pixel port of the founding
  article's bespoke custom CSS/inline-SVG diagram (explicitly allowed to
  defer per the session brief — "flag remaining polish work for Session
  35 rather than blocking today's launch on it"). The diagram's
  descriptive content survives as a blockquote note in the Markdown
  instead of a rendered graphic.
- **No notification integration** — publishing/moderation doesn't emit a
  platform `Notification` today (no natural recipient for "you published
  an article" beyond the author themself, who already sees it on their
  own dashboard); worth revisiting if a "someone unpublished my article"
  notification is wanted.
- **Cover images only** — no multi-file/attachment uploads per article
  beyond the single cover image.

## Blockers

None. The k8s/CI deploy pipeline (`deploy-portal.yml`) was reachable and
used for this session's own deploy — see the handoff in
`status/project-status.md` for the exact PR/deploy record.
