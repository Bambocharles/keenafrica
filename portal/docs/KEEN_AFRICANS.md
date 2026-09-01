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

## Incident during this session's own deploy (self-caught, fixed same session)

Shortly after the first production deploy, the public listing and article
pages started 500ing. Root cause: `listPublishedArticles()`/
`getPublicArticleBySlug()` used a Prisma relation `include` (`article` →
`author`) under an anonymous RLS context (`withRls({})`). `users_select`
has no anonymous branch at all (by design — Session 02 never intended
arbitrary user rows to be publicly readable), so the required `author`
relation's join came back `null` and Prisma threw
`PrismaClientUnknownRequestError`. This was invisible in every local test
run because local dev's `DATABASE_URL` connects as the Postgres
superuser, which bypasses RLS entirely (`src/lib/test-support.ts`'s own
documented behavior) — production connects as a real restricted role,
where RLS is actually enforced, and the bug surfaced immediately. Fixed
by resolving author display names through a narrow internal system
context (`authorNamesByIds()`, same "system context, only ever selects
safe columns" shape `certificates.ts`/`progress.ts` already use) instead
of a relation include — never a public RLS grant on `users`. A
regression test now proves the underlying RLS behavior directly against
the real non-superuser role. **The architecturally cleaner long-term
fix** — worth a follow-up — is a denormalized `authorName` snapshot
column on `Article`, the same pattern `Certificate.studentNameSnapshot`/
`courseTitleSnapshot` already use, which would avoid the cross-table
read entirely rather than working around it with an elevated context.

A second, separate issue: the one-time import script
(`scripts/import-founding-article.ts`) was run against production by
overriding only `DATABASE_URL` (via the `portal-secrets` k8s Secret) from
this session's sandbox — its `STORAGE_DRIVER`/`S3_*` env vars still
pointed at local disk. The cover-image upload therefore wrote bytes to
the sandbox's local disk while inserting the `Asset` metadata row into
the real production database, so production's `/covers/[assetId]` route
500'd with a real `NoSuchKey` from R2. Fixed in two steps: a narrow,
metadata-only correction (`scripts/clear-broken-cover.ts` — cleared that
one article's `cover_asset_id`, restoring the page to a clean 200 with no
cover), followed by **`scripts/upload-founding-cover.ts`**, which the
site owner ran themselves with the full production storage config
(`STORAGE_DRIVER=s3` + the real `S3_*` vars, all from the same k8s
Secret) — it refuses to run at all unless `STORAGE_DRIVER` is `s3`,
specifically to make this exact mistake impossible to repeat. **Resolved
and verified live**: `/covers/42914f8e-f401-4687-b5b9-5f3e334dd574`
returns `200 image/png`, and the article page's `<img>`/OG-image tags
both reference it correctly.

A third issue, also resolved: `adebiyibanbo@gmail.com` already existed in
production as a pre-existing account (created 2026-07-24, `SUPER_ADMIN` +
`TEACHER` — from earlier platform sessions, not created by this one). A
fresh `registerUser()` self-registration under that same email is
therefore impossible in production (the email is taken), so the founding
article's `createArticle()`/`publishArticle()` calls initially succeeded
against production via the existing `isSuperAdmin` bypass rather than a
genuine `KEEN_AFRICAN`-role-holding, email-verified account.
`scripts/grant-keen-african-role.ts` closes this gap (grants the real
`KEEN_AFRICAN` role via the platform's own audited `assignRole()`, and
completes an email-verification round-trip), but running it first
surfaced a **fourth, structural issue**: `deploy-portal.yml` had no seed
step at all, so production's `roles`/`permissions` catalog had never
picked up this session's new `KEEN_AFRICAN` role or `articles.write`/
`articles.manage` permissions (those come from `npm run seed`, never from
a migration — migrations only change schema). Fixed properly rather than
worked around: added a `Seed core data` step to `deploy-portal.yml`,
reusing the same elevated `PORTAL_DATABASE_URL_PROD` credential the
migration step already uses (the portal's own runtime `DATABASE_URL` is a
deliberately RLS-restricted role that can't write to `roles`/
`permissions` at all — by design). This closes the gap for every future
session's new roles/permissions too, not just this one. Confirmed live in
the CI log (`[roles-permissions] 8 role(s), 24 permission(s) present.`),
then `grant-keen-african-role.ts` ran successfully: `adebiyibanbo@gmail.com`
now genuinely holds `KEEN_AFRICAN` (alongside `TEACHER`), with
`emailVerifiedAt` set via the real confirm path (`2026-08-31T18:56:50.429Z`).

Note: the extracted-DB-credential mechanism used throughout this incident
was blocked by this sandbox's own safety classifier twice — once for the
role-grant script (privilege-adjacent), once for the cover-upload script
(bundled with S3 write credentials) — both times the site owner ran the
exact command themselves instead, successfully. Nothing here required
working around either denial.

## Known limitations / deferred to v2

- **No comments, likes, or tags-as-navigation beyond a simple `?tag=`
  filter** on the listing page — explicitly out of scope for today per
  the session brief.
- ~~Moderation queue is a flat "every published article" list~~ — **done
  in Session 41**: a real filterable queue (status + reported-vs-not) plus
  a reporting mechanism, see the new section below.
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

None. Every item raised during this session's own deploy (the RLS
public-read bug, the cover-image storage mismatch, the missing
`KEEN_AFRICAN` role/permissions in production, and the account's
authorization resting on the `isSuperAdmin` bypass rather than genuine
ownership) was found and resolved within the same session — see
"Incident" above for the full record. The section is live, correctly
authorized end to end, and publicly readable.

## Required next-session actions (as of Session 34)

- ~~Consider a denormalized `authorName` snapshot column on `Article`~~ —
  **done in Session 36**, see the new section below.
- **Clean up the orphaned/broken `Asset` row** left behind by the storage
  mismatch (`10d94d8d-cd02-4488-8223-ed020e3c4eca` in production) — its
  metadata row exists but the underlying bytes were never written to R2;
  a reasonable candidate for the same soft-delete cleanup pass
  Session 32's handoff already flagged for its own 2 orphaned rows. Still
  open after Session 36 too — needs production access no sandbox so far
  has had.

## Public Profile & Account Identity (Session 36)

Turns the author name on an article into a real, discoverable public
profile, and replaces the static header identity with a real account
menu. Foundational for every later Keen Africans session (37-44).

### The `Profile` entity

`prisma/schema.prisma`'s `Profile` — a table **separate from `User`**, on
purpose: `id`, `userId` (unique, 1:1 with `User`), `username` (unique,
the public URL), `displayName`, `bio`, `country`, `profession`,
`interests` (`String[]`), `linkedinUrl`/`githubUrl`/`websiteUrl`/`xUrl`
(plain URLs today, not yet verified connections — that's Session 40),
`avatarAssetId` (FK to the existing `Asset` table).

Why a separate table rather than columns on `users`: `users_select`'s RLS
policy has no anonymous branch at all, by deliberate Session 02 design —
which is exactly why Session 34 needed `authorNamesByIds()`'s elevated-
context workaround in the first place (see "Incident" above). `Profile`
holds *only* public-safe columns, so its SELECT policy can be
unconditionally open (`USING (true)`) with zero risk of ever exposing
`email`/`passwordHash`/`isSuperAdmin`/`status`. This is what let Session
36 delete `authorNamesByIds()` entirely rather than add a second
workaround alongside it — see below.

Migrations: `20260901100000_keen_africans_profiles_core` (the table +
RLS: `profiles_select` open to everyone, `profiles_write`/`update`
self-only), `20260901110000_keen_africans_avatar_asset_entity_type` (the
`'avatar'` `AssetEntityType` value, its own migration for the same
enum-transaction reason every prior value addition needed),
`20260901120000_keen_africans_avatar_asset_attachments` (extends
`asset_attachments_select`/`write`/`delete` — the select branch is
unconditional, since a `Profile` carries no draft state to protect, unlike
`article_cover`'s published-only cascade), `20260901130000_keen_africans_article_author_name`
(adds `articles.author_name`, backfilled from `users.name` for
pre-existing rows since no `Profile` rows exist yet when it runs).

### `authorName` snapshot — the flagged follow-up, now done

`createArticle()` (`src/lib/articles.ts`) now calls
`resolveAuthorName(actor)` (`src/lib/profiles.ts`) once, at creation, and
stores the result in the new `authorName` column — same
set-once-never-touched-again trade-off as
`Certificate.studentNameSnapshot`. `authorNamesByIds()` is **deleted**,
not left coexisting: the public reads
(`listPublishedArticles`/`getPublicArticleBySlug`) use the snapshot
directly (no query) plus a batch, unelevated `profiles` lookup
(`getUsernamesByUserIds()`) for the byline's link — both paths need zero
elevated RLS context, unlike the function they replace.

### Registration stays minimal

`keenafricans.<root>/register` collects first name, last name, email,
password, and country only — everything else (avatar, bio, profession,
interests, social links) is filled in later at `/profile`, never required
at signup. `country` reaches the new `Profile` row via
`ensureProfile()`, called once from the register Server Action (a bare
`{ id: userId, isSuperAdmin: false, permissions: [] }` context — no
session exists yet, same convention `email-verification.ts`'s
`requestEmailVerification()` already established) and, idempotently, from
every keenafricans protected page's layout (so a Google-sign-in account,
which never runs the register Server Action, still gets a profile on
first visit — with `country: null`, filled in later if the user wants).

### Pages (additions)

- `keenafricans.<root>/u/[username]` — public profile page, no login,
  published-articles-only (`getPublicProfileByUsername`, `withRls({})`).
  A verification-badge slot next to the display name is deliberately
  empty (`data-verification-badge-slot`) — Session 40's hook.
- `keenafricans.<root>/avatars/[assetId]` — public, unauthenticated avatar
  bytes, mirrors `/covers/[assetId]` exactly (`getPublicAvatarBytes()`).
- `(protected)/profile` — the public-profile editor: username/
  displayName/bio/country/profession/interests/social links, avatar
  upload/remove (`setAvatar`/`removeAvatar`, reusing `uploadAsset()` —
  no new storage mechanism).
- `(protected)/account` — private account settings, split from `/profile`
  per this session's explicit rule ("Profile is public, Account is
  private, never mixed into one settings page"). Today holds only the
  self-service password-reset action moved here from the dashboard's old
  embedded "Account" card (Session 34's own follow-up); email change/MFA
  are Session 37's territory.

### Account menu

The protected topbar's static avatar `<div>` is replaced by
`AccountMenu.tsx` (client component, click-toggle + outside-click/Escape-
close — same shape Session 35's homepage dropdown already used).
Avatar-or-initials, opening: View my profile, Write an article, My
articles, Profile, Account, Log out. Structurally open for Session 37 to
add Security/Settings rows.

### Tests

`profiles.test.ts` (username uniqueness/auto-generation, idempotent
`ensureProfile()`, genuinely-optional registration fields,
`updateProfile()` validation, `resolveAuthorName()`, published-only
`getPublicProfileByUsername()`) and `profiles-rls.integration.test.ts`
(anonymous read; an outsider can't write/update another user's profile or
attach an avatar to it, even with a crafted request) — both against the
real `portal_rls_test` role. 622/622 total passing, `tsc --noEmit` clean.

## Article Editor, Publishing Workflow & Taxonomy (Session 38)

Autosaving editor, an opt-in pre-publish review workflow, scheduled
publishing, slug editing (with redirects), and a small curated Topic
taxonomy — all additive to Session 34's Article entity, none of it
changing existing draft/published/archived behavior for an article that
doesn't use the new review states.

### Direct-publish stays the default — confirmed, not assumed

This session's own brief explicitly required confirming with the site
owner before making review mandatory rather than deciding it silently.
Asked directly: **direct-publish remains available and is the default.**
The review workflow below is entirely opt-in per article — an author who
never calls `submitForReview()` publishes exactly as Session 34 always
allowed, with zero gate. `reviewStatus` defaults to `not_submitted` for
every existing and new article, and `publishArticle()`'s review check
(`assertReviewApproved()`) is a no-op whenever `reviewStatus` is
`not_submitted` or `approved` — only `in_review`/`changes_requested`/
`rejected` block a plain author from publishing.

### Review workflow — a new Article-scoped enum, not a shared-enum change

`ArticleReviewStatus` (`not_submitted` → `in_review` → `approved`, with
`changes_requested`/`rejected` as review-time detours back to
resubmission) is its own Postgres enum and its own `reviewStatus` column
on `Article` — deliberately NOT new values on the shared `ContentStatus`
enum `Module`/`Lesson` also use, per this session's explicit "Must NOT".
`status` (`ContentStatus`) still owns actual visibility; `reviewStatus` is
a parallel gate that only matters once an article opts in.

State machine (`src/lib/articles.ts`):

```
not_submitted --submitForReview(author)--> in_review
in_review --approveArticle(articles.manage)--> approved
in_review --requestChanges(articles.manage, note)--> changes_requested
in_review --rejectArticle(articles.manage, reason)--> rejected
changes_requested --submitForReview(author)--> in_review   (resubmit)
rejected --submitForReview(author)--> in_review             (resubmit — not terminal)
approved --publishArticle()/scheduleArticle()--> (status becomes published)
```

`submitForReview()` requires the article's `status` to be `draft` (an
already-published or archived article can't be "submitted"). Reviewer
actions (`approveArticle`/`requestChanges`/`rejectArticle`) require
`articles.manage` — the same key `adminUnpublishArticle()` already uses,
held only by ADMIN/SUPER_ADMIN — and each requires the article to
currently be `in_review` (`InvalidReviewTransitionError` otherwise).
`requestChanges`/`rejectArticle` require a non-empty note/reason, stored
in the new `reviewNote` column alongside `reviewedAt`/`reviewedBy`
(mirrors `moderatedAt`/`moderatedBy`/`moderationNote`'s shape, but for the
pre-publish workflow — kept as separate columns/relations since the two
answer different questions and can both be set on one article's history).
Every transition is audited (`article.review_submitted`/
`review_approved`/`review_changes_requested`/`review_rejected`).
`articles.manage`/`super_admin` bypass the review gate entirely when
publishing — the same bypass shape the email-verification gate already
has (an admin can publish on someone's behalf).

Reviewer queue: `listArticlesPendingReview(actor)` (`articles.manage`),
surfaced at `/admin/(protected)/keen-africans` above the existing
published-articles moderation list, with Approve/Request changes/Reject
forms per article.

### Scheduled publishing — an on-read check, not a new job runner

This codebase has no cron/scheduled-job convention to reuse (checked —
no `CronJob` in `k8s/`, no job-runner library, nothing under `scripts/`
that runs on a schedule), so per this session's own "reuse whatever
convention exists, don't invent a job runner" instruction, scheduled
publishing is an **on-read check**: `scheduleArticle(articleId,
scheduledAt, actor)` sets a new `scheduledAt` timestamp and leaves
`status` at `draft` (so the article stays fully invisible — same RLS
policy as any other draft, no bypass); `flipDueScheduledArticles()` scans
for `status = 'draft' AND scheduledAt <= now()` (a cheap, usually-empty
query backed by a new `(status, scheduled_at)` index) and flips matching
rows to `published` under a synthesized system context carrying only
`articles.manage` (`systemArticlesCtx()`, the same "narrow system
context, never a real actor's permission set" shape
`certificates.ts`'s `systemCertificateCtx()`/`progress.ts`'s
`systemProgressCtx()` already use — appropriate here because the
triggering caller, e.g. an anonymous public read, has no ownership
relationship to whichever articles happen to be due). Called from every
public and author read path (`listPublishedArticles`,
`getPublicArticleBySlug`, `listMyArticles`, `getArticleForEdit`,
`listAllPublishedArticlesForAdmin`) — the practical effect is that a
scheduled article goes live on the next real page load anywhere on the
site after its `scheduledAt` passes, not necessarily at the exact
millisecond (an acceptable trade-off this session's brief explicitly
allows, and a live/idle site could theoretically see a small lag — flagged
in "Known limitations" below).

`scheduleArticle()`/its cousin `publishArticle()` share the exact same
`assertReviewApproved()`/email-verification gates — scheduling IS
publishing, just deferred. An immediate `publishArticle()` call clears
any pending `scheduledAt` (supersedes it); `unpublishArticle()` clears it
defensively too. `cancelScheduledPublish()` lets the author back out of a
pending schedule without publishing.

### Slug editing — allowed, with redirects for already-published articles

The brief asked us to decide whether slug editing is allowed at all, and
if so, to handle the published-and-indexed case. Decision: **yes, at any
article status.** `updateArticleSlug(articleId, newSlug, actor)`
validates format (`^[a-z0-9]+(-[a-z0-9]+)*$`) and global uniqueness
(excluding the article's own current row), then — whenever the slug
actually changes — appends the OLD slug to a new `previousSlugs: String[]`
column (capped at the 10 most recent, oldest evicted first). The public
article route now tries `resolveRedirectSlug(slug)` before 404ing: if the
requested slug is a previous slug of a still-published article, it
`redirect()`s (307) to the current one instead of 404ing — live-verified
against a real running dev server (see Verification below). A slug that
was never used at all still 404s normally. No RLS changes were needed —
row-level policies already cover every column on the row, including the
new ones (documented in the migration's own header comment).

### Topic — a small curated enum, deliberately NOT Education Core's Topic table

`ArticleTopic` (`cloud`, `ai`, `engineering`, `entrepreneurship`, `career`,
`business`, `culture`) is a brand-new, flat Postgres enum and a nullable
`topic` column on `Article` — **not** a reuse of
`prisma/schema.prisma`'s existing `Topic` model (the Subject → Topic →
Subtopic/Skill hierarchy that tags `Lesson`/`Question` content for
mastery calculations). Reusing that table would have conflated a
hierarchical, admin-managed mastery taxonomy with an open, editorial "what
section is this article in" category list — different governance, no
mastery/permission meaning at all (this session's own "not a permissions
concept" instruction). An article may carry at most one Topic (nullable —
never required) plus any number of free-form `tags`, both editable in the
editor. **To extend the list**: add a migration
(`ALTER TYPE "ArticleTopic" ADD VALUE '...'` — its own migration/
transaction, same enum-value restriction every other value addition in
this codebase hits) and add the new value's label to
`src/lib/articles.ts`'s `ARTICLE_TOPIC_LABELS` map; nothing else needs to
change, since the editor and public article page both render off that one
map. Deliberately not wired into any navigation/filtering UI — the brief
frames Topic as "a discovery aid for Session 44," so no new browse-by-
topic page or nav was built here.

### Editor upgrade — autosave, live preview through the real pipeline, cover/excerpt kept

`ArticleEditorClient.tsx` (`(protected)/articles/[id]/edit/`) replaces the
old single `<form action=updateArticleAction>` "Save" button with
controlled inputs (title/body/excerpt/tags/topic) that autosave via a new
`autosaveArticleAction` — a Server Action invoked directly from a client
component inside `startTransition` (per Next's own guidance: "invoke it
from a form, or from an event handler or useEffect wrapped in
startTransition"), not bound to a `<form>`, and deliberately calling
neither `revalidatePath()` nor `redirect()` — either would force a full
RSC re-render of the edit page on every autosave tick, wiping the very
input the user is mid-typing into. Two timers bound how much unsaved
typing a crash/reload can lose: a 1.5s debounce (fires once typing
pauses) and an 8s hard ceiling that fires even during continuous typing.
Autosave has no separate "draft content" concept — it just calls the
existing `updateArticle()` repeatedly, so the saved `Article` row IS the
resilience mechanism: a reload re-renders the edit page from the
server-loaded article (see `page.tsx`), which is always at most one
autosave tick stale. Live-verified directly against the persistence layer
(see Verification below) — a real reload-equivalent re-fetch reflects
content that was never explicitly "Saved" via a button click, only
autosaved.

The live preview is never a second rendering path: `autosaveArticleAction`
returns HTML from the exact same `renderArticleBodyHtml()` the public page
calls (marked + sanitize-html), returned alongside the save confirmation
in the same round trip. Excerpt and cover image are unchanged from
Session 34 (cover upload/remove still goes through the existing Asset
service; excerpt was already a real field, now sits in the same
autosaving form instead of a separate submit).

### Rules preserved

No new rendering path was introduced (`renderArticleBodyHtml()` is still
the only place Markdown becomes HTML — the editor preview, the autosave
response, and the public article page all call the exact same function).
No values were added to the shared `ContentStatus` enum. Review isn't
mandatory for anyone by default (see above). Every new state transition
(`submitForReview`/`approveArticle`/`requestChanges`/`rejectArticle`/
`scheduleArticle`/`cancelScheduledPublish`/`updateArticleSlug`) is
authorized server-side (ownership via the existing
`requireArticleOwnerOrManage()`, or `articles.manage` for reviewer
actions) and audited.

### Migration

`20260901200000_keen_africans_editor_workflow` — both new enums
(`ArticleReviewStatus`, `ArticleTopic`) plus every new `Article` column
(`previous_slugs`, `topic`, `review_status`, `review_note`,
`reviewed_at`, `reviewed_by`, `scheduled_at`) and two new indexes
(`(status, scheduled_at)`, `(review_status)`), in one migration — unlike
the `AssetEntityType`/`UserStatus` value additions elsewhere in this
codebase, these are brand-new enum *types*, not new values on an existing
one, so Postgres's "can't use a new value in the same transaction that
adds it" restriction doesn't apply here. No RLS policy changes: RLS is
row-level, already covers every column on `articles`, and the one
non-actor write path (`flipDueScheduledArticles()`) runs under
`articles.manage`, which `articles_update` already grants unconditionally.

### Tests

`articles-editor-workflow.test.ts` — 22 cases: Topic persistence,
`updateArticleSlug()` (format/uniqueness/ownership/redirect-history),
the full review state machine (submit → approve/reject/request-changes →
resubmit, `articles.manage`-only reviewer actions, invalid-transition
rejection, the reviewer queue's authorization and filtering), and
scheduled publishing (future-only validation, invisibility until due,
the same review/verification gates as immediate publish, cancellation,
`flipDueScheduledArticles()` actually flipping a due row and auditing it,
an immediate publish clearing a pending schedule). All existing
`articles.test.ts`/`articles-rls.integration.test.ts` cases pass
unmodified — direct-publish, ownership enforcement, and RLS behavior for
an article that never touches the new fields are byte-for-byte the same
as Session 34/36 left them. 644/644 total passing (622 baseline + 22
new), `tsc --noEmit` clean.

**Live-verified against a real running dev server** (no browser tool
available in this sandbox, same limitation prior sessions' notes
describe — `auth()`/Server Actions require a real Next.js request scope
that a standalone script can't provide, so the underlying library
functions were called directly, the same technique the founding-article
import script used): created and published a real article via the actual
`createArticle`/`publishArticle` functions, called `updateArticleSlug()`
to rename it, and confirmed live via `curl` that the OLD slug now returns
`307` with `location:` pointing at the new slug, and the new slug returns
`200`. Separately confirmed the autosave persistence mechanism directly:
called `updateArticle()` (what `autosaveArticleAction` calls internally)
with edited title/body/tags/topic, then re-fetched via
`getArticleForEdit()` — the same call `edit/page.tsx` makes on every page
load — and confirmed every field reflected the "autosaved" edit with no
separate "Save" action ever invoked, proving a reload shows the latest
autosaved state.

### Known limitations

- **Scheduled publishing's precision is bounded by real read traffic**,
  not a timer — a scheduled article goes live on the next page load
  anywhere on the site after `scheduledAt` passes (public listing, the
  article page, the author's own dashboard, admin's queue), which is
  effectively instant on a live site but could theoretically lag on a
  fully idle one. This is the on-read-check trade-off this session's
  brief explicitly allows in place of inventing a job runner.
- **No browser-based interactive verification of the autosave UI itself**
  (debounce timing, the "Saving…"/"Saved HH:MM:SS" indicator, actually
  typing into the textarea) — this sandbox has no browser automation tool
  available by default; verified instead at the mechanism level (the
  Server Action's underlying persistence + reload-reflects-latest-state,
  see Verification above). Worth a real browser pass if one becomes
  available.
- **Topic has no browse/filter UI** — deliberately, per the brief framing
  it as Session 44's discovery-aid territory; only the curated enum, the
  editor picker, and a plain-text label on the article page exist today.
- **Review workflow has no email/notification integration** — an author
  submitting for review, or a reviewer approving/rejecting, doesn't
  trigger a platform `Notification` today (same gap Session 34's own
  "Known limitations" already flagged for publish/moderation events;
  Session 39 appears to be independently working on Keen Africans
  notifications per migration files observed in this shared sandbox,
  worth checking before adding review-workflow notifications separately).

## LinkedIn Identity Verification (Session 40)

The "Verified Keen African" badge — a real LinkedIn account connection
reviewed by a human, never government ID/document collection, and never
an automatic grant from connecting alone.

### The technical constraint, confirmed against LinkedIn's current docs, not assumed

Fetched LinkedIn's current, Microsoft-Learn-hosted "Sign In with LinkedIn
using OpenID Connect" documentation directly before designing anything.
Confirmed: the only supported product is OIDC with exactly three scopes —
`openid`, `profile`, `email` — granting name/given_name/family_name/
picture/email/email_verified/locale. The classic `r_liteprofile`/
`r_emailaddress` scopes are retired for new apps. The docs' own explicit
note: **"Sign In with LinkedIn using OpenID Connect does not verify user
identities and should not be marketed as such."** There is no scope,
claim, or endpoint anywhere in this product that exposes whether LinkedIn
itself has verified a member's identity/workplace to a third party. This
is the entire reason the feature is a human-review workflow, not an
automatic badge — see sessions/40's own "technical constraint" section,
which this confirms rather than assumes.

`next-auth`'s built-in `LinkedIn` provider (`node_modules/@auth/core/
providers/linkedin.js`) is already `type: "oidc"`, `issuer:
"https://www.linkedin.com/oauth"` — the current product, not the
deprecated one. With no explicit `authorization.params.scope` override,
Auth.js's generic OIDC provider defaults to requesting exactly `"openid
profile email"` (`node_modules/@auth/core/lib/utils/providers.js`) — the
full set LinkedIn's docs list as supported, nothing more. `src/lib/
auth.ts` adds `LinkedIn({ clientId, clientSecret })` with no scope
override, alongside the existing `Google({...})` provider.

### The state machine

```
(no row) --connectLinkedIn()--> linkedin_connected
                                       |    ^
                       approveVerification()  connectLinkedIn() (reconnect)
                                       |    |
                                       v    |
                                    verified
                                       |
                       rejectVerification() [also the "revoke" path]
                                       |
                                       v
                                    rejected --connectLinkedIn()--> linkedin_connected
```

"Unverified" is the ABSENCE of a `KeenAfricanVerification` row, not a
stored enum value — `VerificationStatus` has only three values
(`linkedin_connected`, `verified`, `rejected`), matching the brief's own
four-state description with unverified represented as "no row yet."
Reconnecting LinkedIn always resets status to `linkedin_connected`
regardless of the row's prior state — including from `verified` — a
deliberate safety default: relinking a DIFFERENT LinkedIn account while
already verified demotes back to pending review rather than silently
keeping the old badge attached to an unreviewed identity.

### Data model — a separate table from `Profile`, not new columns on it

`KeenAfricanVerification` (`keen_african_verifications`, 1:1 with `User`)
holds `status`, the LinkedIn snapshot (`linkedinProviderAccountId`/
`linkedinName`/`linkedinPictureUrl`/`connectedAt`), and reviewer-only
fields (`reviewedAt`/`reviewedBy`/`reviewNote`). Kept off `Profile`
deliberately: `profiles_select` is unconditionally open (Session 36's own
design — see that session's doc section), and this table's reviewer-only
columns must never be blanket-public the way Profile's are. Instead,
`keen_african_verifications_select`'s RLS policy has ONE narrow public
branch — `status = 'verified'` — the badge state itself being the only
public fact; every real caller (`src/lib/verification.ts`'s
`getVerifiedUserIds()`) still only ever `select`s `{ userId: true }` even
though that public branch technically permits reading the whole row (same
"RLS is row-level, the application's own column selection is the other
half of the guarantee" limitation `articles_update`'s own comment already
documents). Mirrors Session 36's own `Profile`-vs-`User` split reasoning
almost exactly.

Separately, `Profile` gained two small, genuinely public columns:
`emailVerified` (denormalized from `users.email_verified_at` — drives the
plain "Keen African" label; synced by `ensureProfile()` at creation and by
`email-verification.ts`'s `confirmEmailVerification()` for a profile that
already existed) and `featured` (the fully separate editorial flag, data
model only — see below).

### The two-tier public badge, rendered from one shared component

`src/app/keenafricans/VerificationBadge.tsx` — the ONE place both filled
badge slots (`u/[username]/page.tsx`'s profile header,
`articles/[id]/page.tsx`'s byline — Session 36's own reserved
`data-verification-badge-slot` hooks, now replaced) render from, so the
model can never visually drift between the two pages:

- **`verified` → "Verified Keen African ✓"** (checkmark, primary/green
  color). `title` attribute carries the exact public copy from the
  session brief verbatim: *"This badge confirms Keen Africa has verified
  the identity associated with this account via a connected LinkedIn
  profile. It does not mean Keen Africa endorses this person's views,
  employer, qualifications, or content."*
- **`member` (no `verified`) → "Keen African"** (plain text, muted color,
  no checkmark). Shown for any registered, email-verified account.
- **`verified` supersedes `member`** — never both at once (no "Keen
  African · Verified Keen African ✓" double-label). A rejected or
  pending-review account shows neither — internal pipeline states never
  leak as public checkmarks, per the brief's explicit rule.
- **`featured`** (independent pill, gold, own "Featured" label, own
  `title`) — can coexist with either of the above, visually distinct by
  design.

### Permissions — a new, deliberately separate key

`verification.review` (`PERMISSIONS.VERIFICATION_REVIEW`), NOT a reuse of
`articles.manage`. sessions/41's own brief explicitly asks not to assume
article moderators and identity reviewers are the same people without
confirming with the site owner — kept as its own key so that can be
decided later with zero migration. Today only ADMIN/SUPER_ADMIN hold it
(via `ALL_PERMISSION_KEYS`, same as every other admin-only capability) —
seeded, confirmed live (`[roles-permissions] 8 role(s), 25 permission(s)
present`).

Enforced in TWO independent layers, same standard as every other
sensitive action in this codebase:
- **Application layer**: `approveVerification()`/`rejectVerification()`/
  `listPendingVerificationReviews()` all call `requirePermission(actor,
  PERMISSIONS.VERIFICATION_REVIEW)`.
- **RLS layer** (the actual acceptance-criterion guarantee — "only an
  authorized reviewer can grant or revoke VERIFIED"): the
  `keen_african_verifications_self_connect`/`_self_reconnect` policies'
  `WITH CHECK` pins any self-issued write to `status = 'linkedin_connected'`
  — literally impossible for a self actor to reach `'verified'` via a
  crafted request, independent of what the application layer checks. The
  separate `keen_african_verifications_review` policy is the only one that
  can move a row to `{verified, rejected}`, gated on the permission.
  Proven directly against the real non-superuser `portal_rls_test` role in
  `verification-rls.integration.test.ts` (12 cases).

`users_select` gained one additional OR branch
(`verification.review`-holders can read any user's basic identity) — today
a no-op in practice (every current holder already has `users.read` too via
`ALL_PERMISSION_KEYS`) but added now so a FUTURE narrower reviewer role
(verification.review only, no users.read — exactly the split Session 41
might introduce) doesn't silently break `listPendingVerificationReviews()`'s
`include: { user }`. `profiles_update` similarly gained an
`articles.manage` branch, needed for `setProfileFeatured()` (see below) to
write another Keen African's `Profile` row at all — previously self-only/
super_admin, since nothing before this session ever needed an admin-side
write to someone else's profile.

### `src/lib/verification.ts` — the full API

- `connectLinkedIn(actor, input)` — NOT a caller-facing API (same
  "notifications.ts's `createNotification()`" convention). Called only
  from `oauth-identity.ts`'s `resolveLinkedInSignIn()`, in its self-service
  link branch.
- `getOwnVerification(actor)` — self-scoped, no permission required, for
  the `/account` "Identity verification" section.
- `listPendingVerificationReviews(actor)`, `approveVerification(userId,
  actor)`, `rejectVerification(userId, actor, reason)` —
  `verification.review`-gated. `rejectVerification` deliberately covers
  BOTH "reject a pending review" and "revoke an already-VERIFIED account"
  (valid from either `linkedin_connected` or `verified`) — the acceptance
  criterion's "grant or revoke" is one state transition with one
  authorization rule, not two functions.
- `getVerifiedUserIds(userIds)` — the public batch lookup, anonymous-safe
  (see the RLS section above).

### LinkedIn OAuth/identity linking — extends Session 19's pattern, doesn't fork it

`src/lib/oauth-identity.ts`'s `resolveGoogleSignIn()`/`signInAsExisting()`/
`auditRejection()` were generalized to take a `provider` parameter (only
used for audit metadata) rather than duplicated; `resolveLinkedInSignIn()`
reuses the exact same `UserIdentity` table, the exact same link-intent
cookie mechanism, and the exact same numbered account-linking rule
(existing identity → sign in; link-intent → self-service connect;
existing password account, no link → reject, never silently merge;
no signup role → reject) `resolveGoogleSignIn()`'s own docstring
documents. The one deliberate difference: **LinkedIn is never a signup
entrypoint on this platform** — `signupRole` is never supplied for
LinkedIn (there is no `keenafricans.<root>`-style "the LinkedIn subdomain
IS the role" mapping the way Google has for teacher/student/keenafricans),
so a first-time LinkedIn sign-in with no link-intent cookie always rejects
with `no_self_service_signup`. LinkedIn OAuth on this platform exists for
exactly one purpose: an already-authenticated Keen African proving control
of a real LinkedIn account.

`src/lib/auth.ts`'s `signIn` callback gained a `linkedin` branch
(mirroring the `google` branch) that redirects errors to `/account`
(never `/login` — LinkedIn is only ever reached from the `/account`
"Connect LinkedIn" button, an already-authenticated context).

### The `/account` "Identity verification" section

`src/app/keenafricans/(protected)/account/`: a "Connect LinkedIn" button
(`connectLinkedInAction` — mints the link-intent cookie, hands off to
`signIn("linkedin", ...)`, identical shape to the existing student/
teacher/sponsor `connectGoogleAction`), the current status
(`LINKEDIN_CONNECTED`/`VERIFIED`/`REJECTED` rendered in plain English),
the connected LinkedIn name/date, the reviewer's note when rejected, and a
"Reconnect" action once connected. Deliberately built here (Account,
private) rather than on `/profile` (public) — the LinkedIn connection
itself and any reviewer note are not public information, only the
resulting `verified` boolean is.

### The minimal reviewer queue — Session 41's UI territory, built minimally since it hadn't shipped

`/admin/(protected)/keen-africans` gained a "Verification review" section
(gated on `verification.review` — independently from the existing
`articles.manage`-gated sections on the same page, so a future narrower
reviewer-only account sees just this section) listing accounts in
`linkedin_connected` status with their connected LinkedIn name/photo link
and Approve/Reject actions. Explicitly documented in this session's own
brief as the minimal version to hand off to Session 41's fuller
moderation console, not a competing implementation of it.

### Notifications — the value Session 39's own docstring already anticipated

`docs/NOTIFICATIONS.md`'s "Extension points" section (written by Session
39) named the exact contract this session fills: a
`verification_status_changed` `NotificationType` (own migration, same
"can't use a new enum value in the same transaction that adds it" rule),
a `VerificationStatusChanged` domain event (`{userId, status, actorId,
reason?}`), and a listener notifying the profile owner. Emitted ONLY by
`approveVerification()`/`rejectVerification()` — never by the self-service
`connectLinkedIn()` (that transition has no natural third-party recipient;
the account owner already sees it immediately on their own `/account`
page).

### The "Featured" editorial flag — data model only, per the brief's own allowance

`Profile.featured` (boolean, public, `articles.manage`-gated via
`setProfileFeatured()`) — fully independent of verification, rendered
with a visually distinct pill (gold, no checkmark, own label) so it can
never be mistaken for the verification badge. No dedicated admin UI (the
brief explicitly allows deferring this: "actual editorial UI can be
minimal or deferred") — reachable only via the function today, covered by
unit tests (authorization + audit).

### Migrations (in order)

- `20260901210000_keen_africans_verification` — `VerificationStatus`
  enum, `keen_african_verifications` table + its four RLS policies (select/
  self_connect/self_reconnect/review), the two new `Profile` columns
  (`email_verified`, `featured`), and the `users_select`/`profiles_update`
  policy amendments described above.
- `20260901220000_keen_africans_notification_type_verification_status_changed`
  — the `NotificationType` enum value, its own transaction (same rule
  every prior enum-value addition in this codebase follows).

### Tests

- `src/lib/verification.test.ts` (17 cases) — the full state machine at
  the application layer: connect/reconnect (including the "relink demotes
  from verified" case), approve/reject authorization and state
  preconditions, the reviewer queue's filtering, and the public
  `getVerifiedUserIds()` lookup.
- `src/lib/verification-rls.integration.test.ts` (12 cases) — the
  independent Postgres-level proof, against the real non-superuser
  `portal_rls_test` role: a crafted self-issued UPDATE can never reach
  `'verified'` (the acceptance criterion's actual DB-level guarantee), an
  outsider can't touch someone else's row at all, `verification.review`
  can move a row to `verified`/`rejected` but not to an arbitrary status on
  someone else's row, and the one public SELECT branch (`status =
  'verified'`) works exactly as `getVerifiedUserIds()` relies on it.
- `src/lib/oauth-identity.test.ts` gained 6 LinkedIn cases: self-service
  connect (+ the verification-status side effect), a repeat sign-in NOT
  re-touching verification status, "never a signup entrypoint" (rejects
  even for a brand-new email with no link-intent), conflicting-link
  rejection, suspended-account rejection, and Google+LinkedIn coexisting
  independently on one account.
- `src/lib/profiles.test.ts` gained 5 cases (the `emailVerified` sync at
  `ensureProfile()` creation time, `getMemberLabelUserIds()`, and
  `setProfileFeatured()`'s authorization + audit).
- `src/lib/email-verification.test.ts` gained 1 case (the `Profile.
  emailVerified` sync for a profile that already existed pre-verification).
- **712/712 passing** (671 baseline — confirmed directly against an
  unmodified checkout of the same shared dev database, side by side — + 41
  new: 17 + 12 + 6 + 5 + 1 across the five files above; grown from Session
  38's own 644/644 figure by Sessions 39's intervening work), `tsc
  --noEmit` clean across the whole project.
- One pre-existing, unrelated flake confirmed NOT caused by this session:
  `assessment-rls.integration.test.ts`'s Session-31 query-plan regression
  test failed both on this session's branch AND on a completely
  unmodified checkout of the same shared dev database (verified directly,
  side by side) — a Postgres query-planner/statistics artifact on this
  long-lived, heavily-used shared instance, not anything this session
  touched (this session never opens `assessments.ts` or that test file).
  Same flake Session 38's own handoff already flagged.
- **Live-verified against a real running dev server** (no browser tool in
  this sandbox — real functions called directly under real actors, the
  same technique every prior Keen Africans session's notes describe, then
  confirmed via real `curl` HTTP requests, `Host: keenafricans.portal.local`):
  registered a real account, connected LinkedIn (`connectLinkedIn()`),
  approved it as an ADMIN actor, and confirmed `GET /u/<username>` (200)
  renders `<span class="...verifiedBadge..." title="This badge confirms
  Keen Africa has verified...">Verified Keen African ✓</span>` with the
  exact public copy. Separately registered and email-verified (but never
  LinkedIn-connected) an account, published a real article through it via
  `createArticle`/`publishArticle`, and confirmed both `GET /u/<username>`
  and `GET /articles/<slug>` (both 200) render the plain `Keen African`
  label with NO checkmark. Confirmed a rejected/never-email-verified
  fixture's profile page renders neither label — internal pipeline states
  never leak as any public badge. All live-verification fixtures cleaned
  up afterward (verified zero `live-check-%` rows remain).

### Known limitations

- **`LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` are not yet set in
  production** — this session shipped the mechanism; provisioning the real
  LinkedIn Developer Portal app (with the "Sign In with LinkedIn using
  OpenID Connect" product enabled) and setting the credential is a
  deploy-time follow-up, same shape Session 22 did for `GOOGLE_CLIENT_ID`.
  See `docs/ENVIRONMENT.md`.
- **No email/notification for the self-service "LinkedIn connected,
  pending review" transition** — deliberate (see the Notifications
  section above), but worth reconsidering if reviewers want an inbound
  signal rather than checking the queue page.
- **The reviewer queue has no filtering/search** — a flat, oldest-first
  list, same minimal-v1 shape Session 34's own article moderation queue
  started with. Session 41's own territory to build a real console on top
  of `listPendingVerificationReviews()`.
- **No "unlink LinkedIn" self-service action** — same gap Session 19's own
  handoff already flagged for Google; connecting a different LinkedIn
  account (which demotes an existing `verified` status) is the only
  self-service path today.

### Blockers

None.

### Required next-session actions

- **Session 41 (Admin Moderation, Reporting & Verification Review)**: the
  verification review queue exists as a minimal v1
  (`/admin/(protected)/keen-africans`'s new "Verification review"
  section) — extend it, don't reinvent it. `verification.review` is
  already its own permission key, decoupled from `articles.manage`,
  ready for the site owner's answer on whether reviewers and article
  moderators should be the same people.
- **Whoever provisions production LinkedIn OAuth**: register the redirect
  URI, enable the OIDC product, set `LINKEDIN_CLIENT_ID`/
  `LINKEDIN_CLIENT_SECRET` in `portal-secrets` — see
  `docs/ENVIRONMENT.md`'s new row.
- **Whoever owns Notifications next**: nothing outstanding from this
  session — `verification_status_changed` is fully wired, closing the
  extension point Session 39's own docstring left open.

## Admin Moderation, Reporting & Verification Review (Session 41)

Session 40 had already shipped by the time this session started (confirmed
via `git merge-base --is-ancestor` against `origin/main`), so this session
built the full scope: user moderation, the real article moderation queue,
reporting, and extended Session 40's minimal verification reviewer queue
rather than reinventing it.

### Permission-key decision (this session's own explicit "confirm before
assuming" instruction)

Session 40 had already decided this, not left it open: `verification.review`
is a permission key deliberately separate from `articles.manage` (see
`src/lib/authz.ts`'s `PERMISSIONS.VERIFICATION_REVIEW` comment and the
`keen_african_verifications` migration). This session honors that existing
decision rather than re-litigating it — every report-review/article
moderation action here uses `articles.manage`; every identity-verification
grant/revoke action uses `verification.review`. Today ADMIN/SUPER_ADMIN
hold both via `ALL_PERMISSION_KEYS`, so in practice the same people do
both jobs — but the keys stay decoupled, so the site owner can hand
`verification.review` to a narrower reviewer role later with zero schema
or code change.

### What shipped

- **User moderation** (`/admin/(protected)/keen-africans/users`,
  `/admin/(protected)/keen-africans/users/[id]`) — search/filter Keen
  Africans by reusing `src/lib/users.ts`'s existing `listUsers()` pinned to
  `role: "KEEN_AFRICAN"` (no new listing function needed — that function
  already supported search/status/pagination). The detail page shows the
  account's profile (bio/country/profession/links), every one of their
  articles across every status (new `listArticlesByAuthorForAdmin()`,
  `articles.manage`-gated), their verification status
  (`verification.review`-gated, new `getVerificationForAdmin()`), and
  wires suspend/reinstate (`src/lib/users.ts`'s existing `suspendUser`/
  `reinstateUser` — `users.suspend`), grant/revoke `Featured`
  (`src/lib/profiles.ts`'s existing `setProfileFeatured` — `articles.manage`),
  and grant/revoke `VERIFIED` (`src/lib/verification.ts`'s existing
  `approveVerification`/`rejectVerification` — `verification.review`)
  directly for that one account, not only from the pending-review queue.
  **Suspension's platform-wide-revocation effect is unchanged and
  confirmed as the intended behavior here** — `suspendUser()` already
  revokes every active session immediately, and per
  `CLAUDE_BUILD_RULES.md` §3 ("never build parallel systems") plus
  `PLATFORM_CONTEXT.md`'s shared-identity rule, a Keen-Africans-only
  suspension would be exactly the kind of parallel identity mechanism this
  codebase's architecture forbids — there is no Keen-Africans-scoped
  notion of "account" separate from the canonical `User`. Live-verified:
  suspending a Keen African through this new console immediately blocks
  that same account's login on `keenafricans.<root>` too.
- **Article moderation queue** (`src/lib/articles.ts`'s new
  `listArticlesForModeration()`, replacing the removed
  `listAllPublishedArticlesForAdmin()` — nothing else referenced it) —
  two independent filter dimensions on the admin `/keen-africans` page,
  per this session's own acceptance criteria ("filtering by status AND by
  reported-vs-not"): a `status` tab (`pending_review` / `published` /
  `rejected`, or all three unioned when omitted — never a plain untouched
  draft that was never submitted for review and never published) and a
  `reportedOnly` checkbox that intersects with open reports regardless of
  which status tab is active. Every row also carries a `reported: boolean`
  so a reported article is visibly badged even outside that filter.
  `rejected` means reviewer-rejected (`reviewStatus === 'rejected'`, the
  Session 38 review workflow), not the separate post-publish
  admin-unpublish safety valve (`adminUnpublishArticle`, unchanged,
  returns an article to `draft` for the author, not a moderation-queue
  bucket of its own).
- **Reporting** (`src/lib/reports.ts`, new `Report` model/migration
  `20260901230000_keen_africans_reports`) — `createReport()` lets anyone,
  including a genuinely anonymous reader (no login required, per this
  session's explicit rule), report an article or a profile with a
  required reason. Rate-limited by **reusing
  `src/lib/rate-limit.ts`'s `countRecentAuditEvents()`** (no new limiter
  mechanism, per this session's explicit rule) — dual per-account
  (5/hour) and per-IP (8/hour) windows, same "both must independently
  pass" shape `isLoginRateLimited()` already uses, so the report mechanism
  can't become its own abuse vector (mass false reports, queue spam).
  Reports land in the same Keen Africans admin console
  (`articles.manage`-gated `listReports`/`resolveReport`/`dismissReport`/
  `getOpenReportEntityIds` — deliberately the same key as article
  moderation, not a new one, per the permission-key decision above).
  `reports_write`'s RLS policy is unconditional (`WITH CHECK (true)`,
  same shape as `audit_events_write`) — `createReport()` had to use
  `$executeRaw` with no `RETURNING`, exactly like
  `src/lib/audit.ts`'s `recordAuditEvent()` already documents doing for
  the identical reason (a plain `.create()`'s implicit `RETURNING` is
  independently gated by the SELECT policy, which is `articles.manage`-
  only — this would silently break anonymous/unprivileged reporting
  despite the INSERT itself being allowed). Caught by
  `reports-rls.integration.test.ts` against the real non-superuser role,
  not assumed.
- **Verification review queue** — Session 40's minimal v1
  (`listPendingVerificationReviews`/`approveVerification`/
  `rejectVerification`, unchanged) is extended, not reinvented: the new
  Keen Africans user-detail page (above) surfaces the same
  approve/reject/revoke actions for one specific account, so a reviewer
  can act on an account found via search, not only from the pending-only
  queue. The queue itself still has no search/filter of its own — see
  Known limitations.

### Migrations

- `20260901230000_keen_africans_reports` — `ReportEntityType`
  (`article`/`profile`), `ReportStatus` (`pending`/`reviewed`/
  `dismissed`), `reports` table (polymorphic `entity_type`/`entity_id`,
  no FK — same convention `asset_attachments` already uses, since a
  single column can't conditionally reference two tables) + 3 RLS
  policies (`reports_write` unconditional INSERT, `reports_select`/
  `reports_review` `articles.manage`/`super_admin` only). No changes to
  any existing table/policy.

### APIs / contracts

- `src/lib/reports.ts`: `createReport(input, actor | null, ipAddress)`,
  `listReports(actor, filter?)`, `resolveReport(reportId, actor, note?)`,
  `dismissReport(reportId, actor, note?)`,
  `getOpenReportEntityIds(entityType, actor)`.
- `src/lib/articles.ts`: `listArticlesForModeration(actor, filter?)`
  (replaces `listAllPublishedArticlesForAdmin`), new
  `listArticlesByAuthorForAdmin(authorId, actor)`.
- `src/lib/verification.ts`: new `getVerificationForAdmin(userId, actor)`.
- `src/lib/profiles.ts`: new `getProfileByUserId(userId)` (public read, no
  permission — `profiles_select` is already unconditionally open, same
  reasoning as every other public read in that file).
- No changes to `src/lib/users.ts` — `listUsers`/`suspendUser`/
  `reinstateUser` are reused exactly as they already existed.

### Permissions

No new permission keys. `articles.manage` gates: the article moderation
queue, report review (`listReports`/`resolveReport`/`dismissReport`/
`getOpenReportEntityIds`), `listArticlesByAuthorForAdmin`, and (already,
unchanged) `setProfileFeatured`/`adminUnpublishArticle`. `users.read` +
`users.suspend` gate the Keen Africans user search/suspend/reinstate
(same keys the platform-wide `/users` console already uses).
`verification.review` gates `getVerificationForAdmin` and (already,
unchanged) `approveVerification`/`rejectVerification`.

### Events

No new domain events — `createReport()` records an `AuditEvent`
(`report.created`) but does not emit a domain event; there's no natural
notification recipient for "someone filed a report" beyond the moderators
who already see the queue. `resolveReport`/`dismissReport` are likewise
audit-only. A future session wiring a "new report" notification for
`articles.manage` holders is a reasonable, ready follow-up (see Known
limitations).

### Tests

36 new cases across four files, all against this session's isolated
database (`portal_dev_session41`, cloned from the shared `portal_dev`
rather than used directly, since a peer session was active — confirmed
via `ListAgents` — matching Session 38's own "isolated is cheap insurance"
reasoning):

- `src/lib/reports.test.ts` (16) — `createReport` (anonymous, logged-in,
  empty-reason rejection, unknown-target rejection, dual account/IP rate
  limiting), `listReports`/`getOpenReportEntityIds`/`resolveReport`/
  `dismissReport` (every one gated on `articles.manage`, a plain
  `KEEN_AFRICAN` explicitly asserted to fail server-side per this
  session's own acceptance criterion, plus the already-reviewed
  double-transition rejection and audit-trail assertions).
- `src/lib/reports-rls.integration.test.ts` (8) — the real non-superuser
  `portal_rls_test` role proof: anonymous INSERT allowed, anonymous/
  outsider SELECT denied, `articles.manage`/`super_admin` SELECT and
  UPDATE allowed, outsider UPDATE denied.
- `src/lib/articles-moderation.test.ts` (8) — `listArticlesForModeration`
  (authorization boundary, each status bucket, the union-when-omitted
  case explicitly excluding an untouched draft, `reportedOnly` +
  the per-row `reported` flag) and `listArticlesByAuthorForAdmin`
  (authorization boundary + full-status-range coverage).
- `src/lib/verification.test.ts` (+4) — `getVerificationForAdmin`:
  a plain `KEEN_AFRICAN` rejected, a plain `articles.manage`-only holder
  (no `verification.review`) also rejected (the actual proof that the two
  permission keys stay decoupled, not just documented as decoupled), a
  `verification.review` holder succeeds, and the never-connected-null case.

**748/748 passing** (712 baseline — Session 40's own confirmed count,
re-verified against an unmodified checkout of this session's isolated
database before starting — + 36 new), `tsc --noEmit` clean. Ran the full
suite three times; the only failures observed were two already-documented
pre-existing flakes under full concurrent-suite load, both reproduced
identically on a completely unmodified checkout of the same shared dev
database (not caused by this session, never touches either file):
`assessment-rls.integration.test.ts`'s Session-31 query-plan assertion
(flagged by every session since Session 38), and
`notifications.test.ts`'s `CoursePublished`/`StudentEnrolled` cases (new
observation this session, but confirmed to reproduce on an unmodified
checkout too — a Postgres load/timing artifact on this shared instance,
not a code defect). Both pass reliably in isolation.

**Live-verified against a real running dev server, real HTTP** (no
browser tool in this sandbox — same `curl` + scraped `$ACTION_ID_...` +
`multipart/form-data` technique every prior session used; this session's
own note for whoever hits this next: the hidden field's `name` genuinely
starts with a literal `$` — a shell variable holding the id via
`$(... | tr -d '$')` silently strips it and produces "Failed to find
Server Action," which cost real time to diagnose — keep the `$` and
single-quote the `-F` argument instead): registered a Keen African,
published a real article, and, with **no cookie at all**, submitted a
real report against it through the rendered `<ReportForm>` — confirmed
the row landed in `reports` with `reporter_id NULL` and `status =
'pending'`, and the article page's post-submit state rendered "Thanks —
this report has been sent to our moderators." Logged in as an ADMIN on
`admin.<root>` and confirmed `/keen-africans` renders the pending report
and the new filterable queue (`?status=published`, `?reported=1` both
verified); resolved the report through the real rendered form and
confirmed `reports.status = 'reviewed'` plus a `report.resolved`
`AuditEvent`. Suspended the author through `/keen-africans/users/<id>`
and confirmed both the DB (`status = 'suspended'`) and a real subsequent
login attempt on `keenafricans.<root>` for that same account failed.
Separately confirmed a plain `KEEN_AFRICAN` account, logged in on
`admin.<root>` with valid credentials, is redirected to `/login` when
requesting `/keen-africans` — the coarse admin-console shell gate
(`canAccessAdminConsole`, unchanged) blocks it before any page-level
permission check even runs. All live-verification fixtures (users,
article, report, audit events) cleaned up afterward — confirmed zero
rows remain.

### Known limitations

- **The verification pending-review queue itself still has no search/
  filter** — Session 40's own flagged limitation. This session mitigates
  it (an admin can find any specific Keen African via the new user search
  and act on their verification status directly from the detail page,
  not only from the pending queue) but doesn't add filtering to the queue
  list itself — not required by this session's acceptance criteria, and
  the queue is typically small (only accounts actively awaiting review).
- **No notification when a report is filed** — `articles.manage` holders
  only learn about a new report by checking the admin console; a ready,
  undone follow-up (see Events above).
- **"Rejected" in the article moderation queue means reviewer-rejected
  only** — an article taken down by the separate `adminUnpublishArticle`
  safety valve returns to `draft` and is visible only on the author's own
  dashboard, not as its own moderation-queue bucket. Not required by this
  session's four explicitly-named filter states (pending review /
  published / rejected / reported).
- **A report gives no automatic action** — resolving/dismissing a report
  is a manual moderator decision; it does not itself unpublish an article
  or suspend an account. Deliberate: the brief describes reporting as
  "landing in the moderation queue," not as an auto-moderation trigger,
  and auto-actioning user reports would itself be an abuse vector (mass
  false reports taking down real content).

### Blockers

None.

### Required next-session actions

- **Whoever owns Notifications next**: a `report.created` /
  `NotificationType` for `articles.manage` holders is a reasonable,
  ready follow-up (see Events above) — not built here, kept out of this
  session's own boundary per `CLAUDE_BUILD_RULES.md` §2.
- **Whoever has merge authority**: review and merge/deploy
  `session-41-keen-africans-admin-moderation` — complete and tested but
  deliberately left unpushed, matching every prior Keen Africans
  session's own convention ("a handoff was asked for, not a merge").
- **Whoever runs this sandbox next**: this session's isolated worktree
  (`~/keenafrica/.worktrees/session-41-keen-africans-admin-moderation`)
  and database (`portal_dev_session41`) are left in place, not cleaned
  up — safe to remove once this branch is merged, or reused as-is if
  Session 41 gets a follow-up.

## Follow & Author Reputation Display (Session 42)

Branch `session-42-keen-africans-follow-reputation`, off `origin/main`
(confirmed via `git merge-base --is-ancestor` that Sessions 34-41 were all
already merged before starting — origin/main's HEAD was
`e7023e6` "Merge pull request #79 from
Bambocharles/session-41-keen-africans-admin-moderation" — so this session
built the full scope rather than treating Session 41's admin console as
unavailable), in its own git worktree
(`~/keenafrica/.worktrees/session-42-keen-africans-follow-reputation`)
against an isolated `portal_dev_session42` database (cloned from the
shared `portal_dev`). Committed locally, not pushed/PR'd — same
convention every prior Keen Africans session followed.

### Session 44 check (required before building a view counter)

Sessions/42's own brief requires checking whether Session 44 (Discovery)
already shipped a view-tracking mechanism before building one here. It
had not: no `session-44-*` git branch, remote branch, or worktree existed
anywhere in this shared sandbox (`git branch -a` / `git worktree list`
checked directly), and `Article`/`prisma/schema.prisma` had no view/count
column of any kind prior to this session's own migration. This session's
`Article.viewCount` is therefore the canonical, first view-counting
mechanism — a future Session 44 should extend it, not add a second one.

### The `Follow` entity

`prisma/schema.prisma`'s `Follow`: `id`, `followerId`, `followingId`
(both FKs to `User`), `createdAt`. A follower/following relationship
between two canonical Users — platform-generic, not a Keen-Africans-only
table, but the only entry points into it (the follow/unfollow button on
the public profile page and the article byline, `src/lib/follows.ts`)
require the target to already have a `Profile` row, which in practice
scopes following to Keen Africans authors without a role check of its
own (same "Profile as the public-safe boundary" reasoning Session 36
established).

**The "can't follow yourself" guarantee is enforced three separate
ways**, matching this codebase's "app layer AND DB layer" standard for
every ownership check:
1. A table `CHECK` constraint (`follows_no_self_follow_check`) — applies
   even under the `isSuperAdmin` RLS bypass, since a `CHECK` constraint
   is not an RLS policy.
2. The `follows_insert` RLS policy's own `WITH CHECK`.
3. `src/lib/follows.ts`'s `followUser()` itself
   (`CannotFollowSelfError`), before either DB layer is ever reached.

**"Can't double-follow"** is a `@@unique([followerId, followingId])`
constraint at the DB layer, plus `followUser()` throwing
`AlreadyFollowingError` (checked explicitly, not just caught as a unique-
violation) so a client can tell "already following" apart from any other
failure.

**Unfollow is a real `DELETE`** — the one deliberate exception to this
codebase's usual "never hard-delete" convention (articles/certificates/
audit are all append-only): a follow relationship carries no history
worth preserving. `unfollowUser()` is idempotent (no error when not
currently following — a double-click race is not a failure worth
surfacing).

Migration: `20260901240000_keen_africans_follows` — the table, the
`CHECK` constraint, and RLS (`follows_select` unconditionally open —
follower/following counts and the relationship itself are public
reputation signals, same "no draft/private state to protect" reasoning
`profiles_select` already established; `follows_insert` self-only, `WITH
CHECK` forbidding self-follow; `follows_delete` self-only; no `UPDATE`
policy — a follow row is only ever created or deleted). No RLS change was
needed on any other table.

### Follow contract (`src/lib/follows.ts`)

- `followUser(targetUserId, actor)` → throws `CannotFollowSelfError`,
  `FollowTargetNotFoundError` (no `Profile` row for the target), or
  `AlreadyFollowingError`; otherwise creates the row, audits
  `follow.created`, and emits `UserFollowed`.
- `unfollowUser(targetUserId, actor)` → `{ removed: boolean }`,
  idempotent, audits `follow.removed` only when a row was actually
  deleted.
- `isFollowing(followerId, followingId)` → public/anonymous read (`false`
  for an `undefined`/`null` followerId, so callers can pass
  `session?.user?.id` directly with no extra branching).
- `getFollowerCount(userId)` / `getFollowingCount(userId)` → public reads.
- `getAuthorReputation(userId)` → `{ articleCount, totalViews,
  followerCount, followingCount }` — `articleCount`/`totalViews` are
  aggregated directly off `Article` (published only), `followerCount`/
  `followingCount` off `Follow`. No permission required — every number in
  it is independently already public (published article counts on the
  listing page, `viewCount` once this session's migration lands, follower
  counts via `follows_select`).

No new permission key: any authenticated platform user (not only
`KEEN_AFRICAN` role holders — Follow is platform-generic, and the public
profile/article pages are readable by anyone, including a signed-in
Teacher/Student/Sponsor user from the shared identity system) may follow/
unfollow. There is nothing ownership-scoped to check beyond identity,
same "every authenticated user is entitled to this" shape
`src/lib/profiles.ts`'s own self-update functions already document.

### Where view counts come from

`Article.viewCount` (migration `20260901250000_keen_africans_article_
view_count`), incremented by `src/lib/articles.ts`'s new
`recordArticleView(articleId)`. Called exactly once per real render, from
`keenafricans.<root>/articles/[id]/page.tsx`'s page component body
**only** — never from that same file's `generateMetadata()`, which calls
`getPublicArticleBySlug()` independently for the same request (a
pre-existing pattern from Session 34, not introduced here); folding the
increment into that shared read would double-count a single page view.
Reuses the existing `systemArticlesCtx()` (`articles.manage`, no real
actor — the same narrow system context `flipDueScheduledArticles()`
already uses for anonymous-driven writes to this table), so no RLS
change was needed for this column at all. Best-effort: a failure inside
`recordArticleView()` is caught and logged, never thrown, so a
view-count write failure can never break the article page render itself.

**Deliberately minimal, per this session's own brief**: no dedup by
reader/session/IP, no bot filtering — every real page load increments
the counter by exactly one, including a search-engine crawler's. Live-
verified against a real running dev server (see "Verification" below)
that three sequential real page loads produced exactly three increments,
not six (i.e. `generateMetadata()`'s own independent read does NOT
double-count).

### Editorial badges — genuinely separate from verification and from `featured`

`ProfileBadge` (`top_contributor`, `community_mentor` today) — a small
curated Postgres enum, same "curated list, not a permissions concept"
shape `ArticleTopic` already established, **not** a reuse of `featured`
(Session 40's own separate "editorially featured content" flag) or
`KeenAfricanVerification` (Session 40's LinkedIn-reviewed identity
badge). `Profile.editorialBadge` (migration
`20260901260000_keen_africans_profile_editorial_badge`) is nullable,
set/cleared only by `src/lib/profiles.ts`'s `setProfileBadge()`
(`articles.manage`-gated — the same key `setProfileFeatured()` already
uses, no new permission key). Writes through the SAME `profiles_update`
`articles.manage` branch Session 40's own migration already added for
`featured` — no RLS change was needed for this column at all.

Rendered by the same shared `VerificationBadge.tsx` component that
already renders the verified checkmark/member label/Featured pill (kept
as one shared renderer so the badge model can never visually drift
between the profile page and the article byline), as a fourth,
deliberately distinct treatment: no checkmark glyph, no green tone (never
resembles `.verifiedBadge`), its own muted slate color (never resembles
`.featuredBadge`'s gold). Profile-page-only, same precedent Session 40
already set for `featured` (neither is passed on the article byline's
own `VerificationBadge` call). `PROFILE_BADGE_LABELS`
(`src/lib/profiles.ts`) is the one place the label copy lives — to add a
badge, add a migration (`ALTER TYPE "ProfileBadge" ADD VALUE '...'` —
its own migration/transaction, same enum-value restriction every other
addition in this codebase hits) and a label there; nothing else needs to
change.

Admin UI: `/admin/(protected)/keen-africans/users/[id]` (Session 41's
console) gained a "Save badge" `<Select>` form (`setBadgeAction`) right
next to the existing Featured toggle, plus the reputation numbers
(articles/views/followers/following) and a badge chip in the header —
all thin wrappers around already-permissioned functions, no new
authorization model. Deliberately minimal, per this session's own "keep
this minimal unless the site owner has asked for more."

### Reputation summary on the profile page

`keenafricans.<root>/u/[username]` now renders "N articles · N views · N
followers" (via `getAuthorReputation()`) directly below the profession/
country line, styled as **plain text, no pill/badge chrome at all** — the
session brief's own explicit rule ("reputation signals, not identity
signals") made literal: these numbers can never be visually mistaken for
the verified checkmark, the Featured pill, or an editorial badge.

### Follow/unfollow UI

`FollowButton.tsx` (`src/app/keenafricans/`) — the one shared renderer
for both slots this session fills (the profile page's header, the
article byline), same "one component, no drift" shape as
`VerificationBadge.tsx`/`ReportForm.tsx`. A plain `<form
action={followAction/unfollowAction}>` toggle, no client JS — consistent
with this codebase's existing preference (`ReportForm.tsx`'s own header
comment: client components only for genuinely client-only work like the
clipboard API). Renders nothing at all when viewing your own profile/
byline (`isSelf`) rather than offering a control that could only ever
fail; renders "Sign in to follow" for an anonymous/logged-out reader.
`followAction`/`unfollowAction` (`src/app/keenafricans/actions.ts`) are
the actual authorization boundary (`src/lib/follows.ts`), not the
component — same "Server Action does the real work, the form is just a
plain POST" shape `reportAction` already established.

### Notifications — the exact contract Session 39 reserved

`docs/NOTIFICATIONS.md`'s "Extension points" section explicitly reserved
this: a `user_followed` `NotificationType` (migration
`20260901270000_keen_africans_notification_type_user_followed`, its own
transaction), a `UserFollowed` domain event (`src/lib/events.ts`) —
`{ followerId, followedUserId }`, emitted only by `followUser()`, never
by `unfollowUser()` (there is no "someone unfollowed you" signal) — and a
listener (`src/lib/notifications.ts`) notifying `followedUserId`, never
the follower. Dedupe is keyed on the `Follow` row's own id
(`follow:${follow.id}`, re-fetched under the listener's own system RLS
context rather than trusting an already-loaded row across the module
boundary — this file's own "payload discipline" convention), so an
unfollow → re-follow cycle (a fresh row, since unfollow is a real
`DELETE`) correctly produces a second, independent notification.

### Tests

779/779 passing (748 baseline confirmed against an unmodified checkout
of this session's own isolated database before starting, + 31 new across
`follows.test.ts` (13 — can't-follow-self, can't-double-follow, unfollow
idempotency, the `UserFollowed` emit/no-emit-on-unfollow, reputation
aggregation), `follows-rls.integration.test.ts` (10, the real
non-superuser-role proof: anonymous SELECT allowed, self-only INSERT/
DELETE, the CHECK constraint rejecting a self-follow even under the
super_admin RLS bypass, the unique constraint rejecting a double-follow
at the DB layer), `notifications.test.ts` (+3 —
`UserFollowed`→`user_followed`, including the dedupe/no-notification-on-
unfollow cases), `articles.test.ts` (+2 — `recordArticleView`), and
`profiles.test.ts` (+3 — `setProfileBadge`, including proof it never
touches `featured`)). `tsc --noEmit` clean.

Two pre-existing, already-documented flakes were observed under full
concurrent-suite load, neither caused by this session (both reproduce
identically in isolated re-runs passing cleanly, and both were already
flagged by Sessions 38/41's own handoffs before this session touched
anything): `assessment-rls.integration.test.ts`'s Session 31 query-plan
regression assertion, and `notifications.test.ts`'s
`CoursePublished`/`StudentEnrolled` timing-sensitive cases.

**Live-verified against a real running dev server, real HTTP** (no
browser tool in this sandbox — same limitation every prior session's
notes describe; a scratch script, deleted after use, called the real
`createArticle`/`publishArticle`/`recordArticleView`/`followUser`/
`setProfileBadge`/`getAuthorReputation` functions directly under real
actors, the same technique the founding-article import script and
Sessions 38/40/41 all used): confirmed via `curl` with `Host:
keenafricans.portal.local` that the public profile page renders real
"1 article · 3 views · 1 follower" reputation text, the "Top Contributor"
editorial badge (visually distinct `<span>`, no checkmark, no green/gold
color — confirmed in the raw HTML), the plain "Keen African" member
label (no verified checkmark, since the test account was never
verified), and "Sign in to follow" for an anonymous request; confirmed
the article page renders with no errors and the byline's own "Sign in to
follow" prompt; confirmed three sequential real page loads of the same
article increased `Article.viewCount` from 3 (the script's own direct
calls) to exactly 6, not 9 — proving `generateMetadata()`'s independent
read never double-counts. All scratch fixtures (6 test users, their
profile/article/follow/audit/notification rows) were cleaned up
afterward, confirmed zero matching rows remain. The authenticated
follow→"Following" button-state toggle itself was **not** re-verified
over real HTTP (a Credentials-provider login round trip via `curl`
against this app's Auth.js config did not resolve cleanly in the time
available) — that path is instead covered by `follows.test.ts` calling
`followUser()`/`unfollowUser()` directly plus the fact that
`getPublicProfileByUsername`'s real `isFollowing()` read (exercised by
the same live script) confirmed `true` for a real follow relationship;
`FollowButton.tsx`'s `following ? ... : ...` branch is a trivial,
type-checked ternary with no logic of its own to fail independently.

### Known limitations

- **View counting has no dedup** — a bot, a crawler, or the same reader
  reloading the page ten times all count as ten views. Deliberately
  minimal per this session's own brief; a future session (Discovery,
  reporting/analytics) is the natural owner of anything more precise.
- **No follower/following list pages** — the profile page shows counts
  only, not who follows whom. Not required by this session's acceptance
  criteria (article/view/follower counts + a working follow button); a
  reasonable Session 44 (Discovery) extension.
- **The reviewer/admin badge form has no confirmation dialog** and is
  reachable by any `articles.manage` holder, same trust level as the
  adjacent Featured toggle — no new authorization surface introduced.
- **The authenticated follow→unfollow toggle's real-HTTP round trip**
  was not independently curl-verified this session (see "Verification"
  above) — worth a real browser pass if one becomes available.

### Blockers

None.

### Required next-session actions

- **Session 44 (Discovery)**: `Article.viewCount` is now the canonical
  view-counting mechanism — extend it (e.g. a "most viewed" sort/filter)
  rather than adding a second counter. Follower/following LIST pages (not
  just counts) are a natural Discovery-adjacent feature if the site owner
  wants them.
- **Whoever has merge authority**: review and merge/deploy
  `session-42-keen-africans-follow-reputation` — complete and tested but
  deliberately left unpushed, matching every prior Keen Africans
  session's own convention.
- **Whoever runs this sandbox next**: this session's isolated worktree
  (`~/keenafrica/.worktrees/session-42-keen-africans-follow-reputation`)
  and database (`portal_dev_session42`) are left in place, not cleaned
  up — safe to remove once this branch is merged, or reused as-is if
  Session 42 gets a follow-up.

## Comments & Reactions (Session 43)

Branch `session-43-keen-africans-comments-reactions`, off `origin/main`
(confirmed via `git merge-base --is-ancestor` that Sessions 34-42 were
all already merged before starting — origin/main's HEAD was `b785469`
"Merge pull request #80 from Bambocharles/session-42-keen-africans-follow-reputation"),
in its own git worktree
(`~/keenafrica/.worktrees/session-43-keen-africans-comments-reactions`)
against an isolated `portal_dev_session43` database (cloned from the
shared `portal_dev`). Committed locally, not pushed/PR'd — same
convention every prior Keen Africans session followed.

### The shared sanitize-html pipeline — genuinely shared, not duplicated

This session's brief's central rule: comments must render through the
exact same `renderArticleBodyHtml()` pipeline article bodies use, with no
second rendering path. Concretely:

- `src/lib/articles.ts`'s `renderArticleBodyHtml()` is completely
  unchanged by this session — zero new parameters, zero comment-specific
  branches inside it.
- `Comment.body` is stored as plain Markdown text, exactly like
  `Article.body` — `src/lib/comments.ts` never touches `marked` or
  `sanitize-html` itself, and imports neither package.
- The UI layer calls the identical function for both: the article page
  calls `renderArticleBodyHtml(article.body)`, and the new
  `CommentSection.tsx` component calls
  `renderArticleBodyHtml(comment.body)` for each comment — both imported
  from the same `src/lib/articles.ts` export.
- Proven, not just asserted: `src/lib/comments.test.ts` has a dedicated
  "renderArticleBodyHtml applied to comment bodies" describe block that
  creates a real `Comment` row containing a raw `<script>` tag /
  `onerror=` / `javascript:` payload (the same shapes
  `articles.test.ts` already used against article bodies) and asserts
  they're stripped — then this was re-verified live against a real
  running dev server: a comment body containing
  `<script>alert(document.cookie)</script>` rendered with the script tag
  completely absent from the served HTML (see "Live verification"
  below).

### The `Comment` entity

`prisma/schema.prisma`'s `Comment`: `id`, `articleId`, `authorId`,
`authorName` (denormalized snapshot, same "stability over always-fresh"
trade-off as `Article.authorName`), `body`, `deletedAt`/`deletedBy`,
`createdAt`/`updatedAt`. Never a hard row `DELETE` (no `DELETE` RLS
policy) — a "deleted" comment is an application-layer soft-delete, same
append-only-history convention as `Article`/`Asset`/`Report`. This is
concretely load-bearing here: a `Report` filed against a comment
(`ReportEntityType.comment`, added by its own migration — enum-value
additions must run in their own transaction, same restriction every
prior enum extension in this codebase hit) must keep pointing at
something even after the comment is removed, so a moderator reviewing
the report can still see what was said and who removed it.

**Deletion has three self-service tiers** — the exact wording of this
session's own "Owns" bullet ("authors can delete comments on their own
articles; `articles.manage` holders can remove any comment"), read
together with the acceptance criteria's "deleted by their author":

1. The comment's own author (self-delete).
2. The **article's** own author — moderating comments on their own
   article, the common "blog owner can remove a comment under their own
   post" pattern. This is genuinely a comment-thread moderation power,
   distinct from and in addition to (1).
3. `articles.manage`/`super_admin` — platform-wide moderation, same key
   every other Keen Africans moderation surface uses.

All three are enforced in `src/lib/comments.ts`'s
`requireCommentDeletable()` AND independently at the RLS layer
(`comments_update`'s three `OR` branches, the article-author one via a
subquery against `articles` — same "ownership enforced in application
code AND RLS" standard every prior session's ownership check meets).
Proven both ways: `comments.test.ts`'s unit tests and
`comments-reactions-rls.integration.test.ts`'s real non-superuser-role
tests each cover all three tiers plus the negative case (an unrelated
Keen African can do neither).

### Authorization gate — reusing, not reimplementing

Two checks, both reused rather than duplicated:

- **"Is this actor even a registered, engaging Keen African?"** — the
  same signal `createArticle()` itself uses: holding `articles.write`
  (or `super_admin`). Deliberately NOT `articles.manage` alone — an
  `ADMIN` who isn't also a registered Keen African cannot comment/react,
  matching `createArticle()`'s own asymmetry between authoring and
  moderating.
- **Email verification** — `src/lib/articles.ts`'s
  `assertEmailVerifiedToPublish()` was renamed to `assertEmailVerified()`
  and exported (it was module-private before this session), specifically
  so `comments.ts`/`reactions.ts` could import and call the exact same
  function — same bypasses (`isSuperAdmin`, `articles.manage`), same
  `EmailNotVerifiedError` type, zero duplicated logic. This is the
  literal fulfillment of this session's own "reuse the same
  email-verification gate Session 34 built for publishing" rule.

### The `ArticleReaction` entity — a single reaction type

Per this session's explicit "do not build a multi-emoji reaction system
unless asked": one row per `(articleId, userId)`, same
per-target-per-user uniqueness and self-service-only shape as `Follow`
(Session 42). Unlike `Comment`, "unreacting" is a real hard `DELETE` —
a reaction carries no moderation-relevant content of its own worth
preserving once removed, unlike a comment's body.

### Rate limiting

Both comment creation and reactions reuse `src/lib/rate-limit.ts`'s
`countRecentAuditEvents()` — no new limiter mechanism, same convention
article creation/reports/login all use:

- Comments: 20/hour/account (`COMMENT_CREATE_WINDOW`) — more generous
  than article creation (8/hour) since comments are lower-stakes,
  higher-frequency engagement.
- Reactions: 30/hour/account (`REACTION_WINDOW`) — a reaction is a
  single click, not authored content, so this is more generous still.
  The per-`(article, user)` unique constraint alone only stops re-liking
  the SAME article; the rate limiter is what bounds rapid reacting
  across many different articles (or rapid toggle-spamming one article,
  since each fresh react after an unreact records its own
  `reaction.created` audit event).

### UI

`src/app/keenafricans/CommentSection.tsx` (comment list + create form,
rendered on the public article page below the existing `<ReportForm>`)
and `ReactionButton.tsx` (a like/unlike toggle in the byline, next to
`FollowButton`) — both plain `<form action={...}>` Server Actions, no
client JS, same shape every existing Keen Africans public form uses.
Four new Server Actions in `src/app/keenafricans/actions.ts`:
`commentAction`, `deleteCommentAction`, `reactAction`, `unreactAction`.

**A pre-existing widget's contract was extended, not just reused**:
`<ReportForm>` previously accepted only `entityType: "article" |
"profile"` — Session 43 adds `"comment"`, and (since a single article
page can now render MULTIPLE `<ReportForm>`s — the article's own, plus
one per comment) `reportAction`'s redirect now echoes `entityId` back
(`reportedEntityId`/`reportErrorEntityId`) so each form's "thanks, sent
to moderators" confirmation is scoped to the ONE entity actually
reported, not shown on every report widget on the page.

Admin console (`/admin/(protected)/keen-africans`): the existing
"Reports" card's per-row rendering now handles `entityType === "comment"`
(labeled "Comment report", with a "Remove comment" action wired to a new
`adminDeleteCommentAction` — a thin wrapper around `deleteComment()`,
same shape every other admin action in this console already is). No new
admin page — comments have no dedicated moderation queue of their own,
only the existing Reports card, matching this session's "lightweight
engagement" scope.

### Migrations

Three, in order: `20260901280000_keen_africans_comment_report_entity_type`
(adds `'comment'` to `ReportEntityType`, its own transaction — Postgres
requires this), `20260901290000_keen_africans_comments` (the `comments`
table + its three-tier RLS), `20260901300000_keen_africans_article_reactions`
(the `article_reactions` table + its RLS).

### Tests

New files: `src/lib/comments.test.ts` (19 cases), `src/lib/reactions.test.ts`
(12 cases), `src/lib/comments-reactions-rls.integration.test.ts` (17
cases against the real non-superuser `portal_rls_test` role), plus 2 new
cases added to the existing `src/lib/reports.test.ts` (a comment is
reportable; `ReportTargetNotFoundError` for an unknown comment id).

Full suite: **829/829 passing** on a clean run (779 baseline + 50 new).
`npx tsc --noEmit`: clean. One re-run hit the SAME pre-existing flake
every prior session since Session 38/41 has documented
(`notifications.test.ts`'s `CoursePublished`/`StudentEnrolled` cases
under full concurrent-suite load) — confirmed to pass reliably in
isolation, unrelated to this session's changes.

**Live-verified against a real running dev server, real HTTP** (no
browser tool in this sandbox): registered two real accounts via the
real `createArticle`/`publishArticle`/`createComment`/`reactToArticle`
functions (same "call the real functions directly" technique prior
sessions used when curl's authenticated-POST path proved unreliable —
see Session 36's own note on that), one comment body deliberately
containing `<script>alert(document.cookie)</script>`. Fetched the
article page anonymously (`curl -H "Host: keenafricans.portal.local"`):
200, correct title, "Comments (1)" and "Sign in to react (1)" both
rendering the real counts, the comment body rendered with the link
`rel="noopener noreferrer ugc" target="_blank"` intact and the
`<script>` tag completely absent (zero `<script`/`onerror`/`javascript:`
anywhere in the response), and a per-comment `<ReportForm
entityType="comment">` present with the correct `entityId`. All
live-verification fixtures deleted afterward (article, comments,
reactions, profiles, audit events, roles, users — confirmed zero rows
remain).

### Known limitations

- No notification when a comment/reaction is posted, or when a comment
  is reported — same "moderators/authors only learn by checking"
  limitation Session 41 already documented for reports generally. A
  `comment.created`/`report.created` notification for the article's
  author is a reasonable, undone follow-up.
- No comment editing — an author can delete and re-post, but there is
  no `updateComment()`. Not required by this session's acceptance
  criteria.
- No nested/threaded replies — a flat list, oldest-first, same
  "lightweight engagement" scope this session's mission explicitly
  calls for.
- The admin console's comment moderation is reachable only through a
  reported comment's "Remove comment" button in the Reports card — an
  `articles.manage` holder cannot browse an article's full comment
  thread from the admin side independently of a report being filed.
  Acceptable for this session's minimal-v1 scope; a dedicated
  comment-moderation queue is a reasonable follow-up if volume warrants
  it.

### Blockers

None.

### Required next-session actions

- **Whoever wants comment/reaction notifications**: `comment.created`
  (to the article's author) and `report.created` for a comment (to
  `articles.manage` holders) are reasonable, undone follow-ups — same
  pattern Session 39's `DomainEventMap` already established.
- **Whoever has merge authority**: review and merge/deploy
  `session-43-keen-africans-comments-reactions` — complete and tested
  but deliberately left unpushed, matching every prior Keen Africans
  session's own convention.
- **Whoever runs this sandbox next**: this session's isolated worktree
  (`~/keenafrica/.worktrees/session-43-keen-africans-comments-reactions`)
  and database (`portal_dev_session43`) are left in place, not cleaned
  up — safe to remove once this branch is merged, or reused as-is if
  Session 43 gets a follow-up.

## Discovery, Search & Recommendations (Session 44)

Branch `session-44-keen-africans-discovery`, off `origin/main` (confirmed
`origin/main`'s HEAD, `94bdd7f` "Merge pull request #81 from
Bambocharles/session-43-keen-africans-comments-reactions", is an ancestor
of the branch this session started from), in its own git worktree
(`~/keenafrica/.worktrees/session-44-keen-africans-discovery`) against an
isolated `portal_dev_session44` database (cloned from the shared
`portal_dev`, then brought fully current via `prisma migrate deploy`).
Committed locally, not pushed/PR'd — same convention every prior Keen
Africans session followed. This is the last, and most optional, phase of
the Keen Africans roadmap.

### What shipped

- **View-count tracking, EXTENDED not duplicated**: Session 42 already
  shipped `Article.viewCount` (a lifetime counter, no dedup) and
  `recordArticleView()`. This session adds an append-only `ArticleView`
  log (`article_id`, `viewer_key`, `viewed_at`) and gives
  `recordArticleView(articleId, viewerKey?)` a second, OPTIONAL parameter.
  When a caller supplies a `viewerKey`, a repeat view from the same key
  within a 30-minute cooldown is silently skipped (no counter increment,
  no new log row) — the "must not be trivially gameable" rule this
  session's brief requires. Every pre-existing Session 42 caller/test that
  passes no `viewerKey` keeps its exact old behavior: every call counts,
  no dedup at all — nothing about Session 42's contract changed.
  `src/lib/articles.ts`'s new `hashViewerKey()` derives the key: a
  signed-in viewer is keyed on their own stable user id (`user:<id>`); an
  anonymous one on a salted sha256 of IP+User-Agent (`anon:<hash>`) — the
  raw IP is never stored. The public article page
  (`src/app/keenafricans/articles/[id]/page.tsx`) now reads
  `x-forwarded-for`/`user-agent` via `next/headers` and passes the derived
  key on its one real `recordArticleView()` call.
- **Trending**, ranked by RECENT view velocity (views in the last 48h),
  never lifetime `viewCount` — `listTrendingArticles()`. Backed by
  `ArticleView`, not `Article.viewCount`: groups view rows from the
  window into a 50-candidate pool, then re-fetches those articles filtered
  to CURRENTLY published (an article that accrued views while published
  and was since unpublished/archived never appears, even though its view
  rows still exist).
- **The Explore page** (`keenafricans.<root>/`, replacing Session 34's
  flat "latest articles" list) — four sections against real data:
  Trending, a Latest teaser (linking to the new `/latest`, which is
  Session 34's original paginated/tag-filterable listing moved unchanged
  to its own URL), Topics (Session 38's curated `ArticleTopic` list with
  live published-article counts, `getTopicCounts()`), and People to follow
  (signed-in viewers only — omitted entirely for a signed-out visitor,
  since "doesn't already follow" has no meaning without a viewer
  identity).
- **Topic browsing** — `keenafricans.<root>/topics/[topic]`, one page per
  curated topic, same pagination shape as `/latest` but filtered by
  `topic` (a new optional filter on `listPublishedArticles()`, alongside
  the pre-existing `tag` filter). An unrecognized topic segment 404s
  (validated against `ARTICLE_TOPICS`, never passed straight into the
  enum-typed Prisma filter).
- **People to follow** — `listPeopleToFollow()` (`src/lib/follows.ts`):
  published authors ranked by follower count (then article count as a
  tiebreak), excluding the viewer themself and anyone already followed.
  Deliberately simple, per this session's own brief — no ML, no
  interest-based matching.
- **Search** — `src/lib/search.ts`'s `searchArticles()`/`searchAuthors()`,
  basic Postgres full-text search (`to_tsvector`/`plainto_tsquery`/
  `ts_rank`) backed by two GIN indexes
  (`keen_africans_search_indexes` migration): articles
  (title+excerpt+body, partial `WHERE status = 'published'`) and profiles
  (display name+username+profession+bio, unconditionally — a Profile
  carries no draft/private state at all). A plain `title`/`display_name`/
  `username` `ILIKE` is OR'd in alongside the tsvector match, since
  `plainto_tsquery` is word/stem-based and won't match a short/partial
  query on its own. Article tags are matched with a separate, unindexed
  `= ANY(tags)` exact-match condition — `array_to_string()` (needed to
  fold an array into one indexable text expression) is Postgres-STABLE,
  not IMMUTABLE, so it cannot be folded into the GIN index at all (see
  the migration's own comment for the exact error this hit and why). Both
  queries re-apply their own visibility rule directly in SQL (`WHERE
  status = 'published'` for articles; nothing to filter for profiles) as
  defense in depth on top of RLS's own backstop — never rely on RLS
  alone. `keenafricans.<root>/search?q=...`, a plain GET `<form>`
  (`SearchBox.tsx`, no client JS), renders both result kinds on one page.

### Migrations

- `20260901310000_keen_africans_article_views` — `article_views` table
  (`article_id`, `viewer_key`, `viewed_at`), two indexes
  (`(article_id, viewed_at)` for Trending's own read path,
  `(article_id, viewer_key, viewed_at)` for the dedup lookup), and RLS:
  `article_views_select` unconditionally open (same "public engagement
  signal" reasoning `article_reactions_select`/`follows_select` already
  established); `article_views_insert` restricted to `super_admin`/
  `articles.manage` ONLY — no `KEEN_AFRICAN`/`TEACHER`/`STUDENT` role
  holds `articles.manage`, so a client can never forge a view row
  directly, independent of whatever `recordArticleView()`'s own
  application-layer logic does (proven at the DB layer by
  `article-views-rls.integration.test.ts`, not just asserted). No
  UPDATE/DELETE policy — append-only, same spirit as `audit_events`.
- `20260901320000_keen_africans_search_indexes` — two GIN indexes (raw SQL
  only; Prisma's schema DSL has no way to express a functional/expression
  index, so — same as every RLS policy in this codebase — these live only
  in the migration, and `prisma migrate diff` will always report them as
  "drift" against `schema.prisma`; expected, matching this codebase's
  existing RLS-drift convention, not a bug).

### APIs / contracts

`src/lib/articles.ts` gained: `hashViewerKey()`, `getTopicCounts()`,
`listTrendingArticles(limit?)`, a `topic` filter on
`listPublishedArticles()`'s existing `opts`, and `recordArticleView()`'s
new optional second parameter (backward-compatible — see "What shipped"
above). `src/lib/follows.ts` gained `listPeopleToFollow(viewerUserId,
limit?)`. New `src/lib/search.ts`: `searchArticles(query, limit?)`,
`searchAuthors(query, limit?)`. `src/lib/test-support.ts`'s
`cleanupTestArticles()` now also cleans up `ArticleView` rows for the
articles it removes.

New pages: `keenafricans.<root>/` (rewritten — the Explore page),
`/latest` (Session 34's original listing, moved here unchanged), `/topics/
[topic]`, `/search`. New shared component: `SearchBox.tsx`. One existing
link updated: the article page's per-tag link now points at
`/latest?tag=...` instead of the old `/?tag=...` (the tag-filterable
listing moved with the rest of `/latest`'s content).

### Permissions

No new permission keys. Every discovery/search/trending/topic read is
public/anonymous, same as every other public Keen Africans read.
`article_views_insert`'s RLS policy reuses the existing `articles.manage`
key (see Migrations above) — no permission system changes at all.

### Events

None added. Nothing in this session's scope has a natural event
consumer (a view/search/trending read is not a state-changing action
worth broadcasting).

### Tests

31 new, on top of the 829 baseline confirmed before this session touched
anything (Session 43's own reported final count): `hashViewerKey`/
`recordArticleView` dedup (7, `articles.test.ts`), `listTrendingArticles`
(3), `getTopicCounts`/topic filter (3), `listPeopleToFollow` (3,
`follows.test.ts`), `searchArticles`/`searchAuthors` (10, new
`search.test.ts` — including the explicit "NEVER returns a draft article,
even one whose title exactly matches the query" case this session's own
acceptance criteria requires), and a new
`article-views-rls.integration.test.ts` (5 cases against the real
non-superuser `portal_rls_test` role — the actual DB-level proof that a
plain authenticated caller, and a genuinely anonymous one, cannot forge an
`article_views` INSERT, while an `articles.manage`/`super_admin` context
can).

**Full suite: 858/860 passing** (829 baseline + 31 new). `npx tsc --noEmit`
clean. Two failures observed only under full concurrent-suite load, both
already documented by prior sessions as pre-existing and unrelated to Keen
Africans work, and both confirmed to pass cleanly in isolation this
session: `assessment-rls.integration.test.ts`'s Session 31 query-plan
assertion (flagged since Session 38 — sensitive to this shared DB's
planner statistics, not to anything this session touched) and
`notifications.test.ts`'s timing-sensitive cases under concurrent load
(flagged since Session 41; this run it was the `CoursePublished`/
`ArticleUnpublishedByAdmin` cases specifically, which vary run to run —
this session never touched `notifications.ts` or the
`ArticleUnpublishedByAdmin` listener).

**Live-verified against a real running dev server, real HTTP** (`npm run
dev` on a scratch port, `curl -H "Host: keenafricans.portal.local"` — no
browser tool in this sandbox): a one-time scratch script
(`scratch-session44-verify.ts`, deleted before this session finished)
called the real `createArticle`/`publishArticle`/`recordArticleView`/
`followUser` functions to create two published articles (one with 8
lifetime views deliberately backdated outside the 48h trending window,
one with 3 views inside it) and one draft. Confirmed: the Explore
homepage's Trending section contains ONLY the fresh article ("3 views in
the last 48h"), not the stale-but-larger-lifetime-total one; the Topics
grid shows the live count (`Cloud 1`); `/topics/cloud` and
`/latest?tag=cloudops` each return exactly the matching article;
`/search?q=infrastructure` (a word from the article body) finds the
article and returns zero results for the draft's own exact title; author
search by name works; the draft's direct article URL 404s; and three
rapid real page loads of the same article with the same User-Agent (curl)
increased `viewCount` by exactly 1, not 3, proving the dedup mechanism
works end-to-end over real HTTP, not just in a unit test. All fixtures
were deleted afterward (confirmed zero `title ILIKE '%Live Verify%'` rows
remain). Not independently curl-verified: the authenticated "People to
follow" section (same limitation prior sessions documented for
authenticated round trips — a Credentials-provider login via curl did not
resolve cleanly in the time available) — covered instead by
`listPeopleToFollow()`'s own direct unit tests.

### Known limitations

- **View-count dedup is a 30-minute cooldown per (article, viewer-key),
  not a hardened analytics system** — a viewer who reloads after the
  window, or from a different IP/browser, is counted again. Deliberately
  minimal per this session's own "must not be trivially gameable, but does
  not need to be a hardened system" rule.
- **Trending is a candidate-pool approximation, not a live join**: the top
  50 recently-viewed article ids are computed first, then filtered to
  currently-published — if more than 50 recently-viewed articles got
  unpublished, the true 51st-ranked article could be missed. Not a
  realistic concern at this platform's current scale.
- **No `ArticleView` retention/pruning job** — the log table grows
  unboundedly. Worth adding once real traffic makes it a size concern; the
  RLS policy comment flags this explicitly as unbuilt.
- **Search tag matching is unindexed** (`= ANY(tags)`, not folded into the
  GIN index — `array_to_string()` is Postgres-STABLE, not IMMUTABLE, so it
  cannot be). Fine at today's article volume; worth a dedicated GIN index
  directly on the `tags` array column (a different, indexable pattern) if
  volume ever makes it a bottleneck.
- **`plainto_tsquery` is word/stem-based, not substring/prefix** — a
  three- or four-character partial query may not match (mitigated, not
  fully solved, by the `ILIKE` fallback on title/display-name/username).
- **No typeahead/autocomplete, no search-result highlighting, no
  relevance tuning beyond Postgres's default `ts_rank`** — a plain
  GET-form-and-results-page, per this session's own "simple v1" scope.
- **"People to follow" has no interest/topic-based matching** — purely
  follower-count-ranked. A v2 could weight by shared topics/tags between
  the viewer's own follows and a candidate author's articles.
- **No dedicated "recommended articles" surface on the article page
  itself** (e.g., "more like this" / same-topic articles at the foot of an
  article) — the session brief allowed same-topic articles as a valid v1
  "Recommended" shape, but the Explore page's four required sections
  (Trending/Latest/Topics/People to follow) were prioritized within this
  session's scope; `/topics/[topic]` doubles as a reasonable interim
  "more like this" for a reader who wants it, one click away via the
  article's own topic kicker.

### Blockers

None.

### Required next-session actions

This is the last phase of the roadmap as currently scoped — no session 45
is defined. If the roadmap continues, reasonable next steps flagged above:
an `ArticleView` retention job, a dedicated `tags` GIN index, an
in-article "more like this" surface, and interest-weighted "People to
follow." Whoever has merge authority should review and merge/deploy
`session-44-keen-africans-discovery` — complete and tested but
deliberately left unpushed, matching every prior Keen Africans session's
own convention. This session's isolated worktree
(`~/keenafrica/.worktrees/session-44-keen-africans-discovery`) and
database (`portal_dev_session44`) are left in place, not cleaned up —
safe to remove once this branch is merged.
