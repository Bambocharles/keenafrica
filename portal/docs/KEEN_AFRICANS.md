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
