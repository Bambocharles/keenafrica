import { createHash, randomUUID } from "crypto";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { ArticleTopic } from "@prisma/client";
import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { actorRlsCtx } from "@/lib/courses";
import { countRecentAuditEvents } from "@/lib/rate-limit";
import { uploadAsset, deleteAssetIfOrphanedAsContentOwner } from "@/lib/assets";
import { getStorageDriver } from "@/lib/storage";
import { resolveAuthorName, getUsernamesByUserIds, getMemberLabelUserIds, anonymizeOwnProfile } from "@/lib/profiles";
import { getVerifiedUserIds } from "@/lib/verification";
import { anonymizeOwnAccount, assertOwnAccountDeletable } from "@/lib/users";
import { getOpenReportEntityIds } from "@/lib/reports";

/**
 * Keen Africans — Article entity (Session 34). Open self-registration, no
 * pre-publish review: anyone with the KEEN_AFRICAN role can create, edit,
 * and publish their OWN article (ownership enforced here AND independently
 * at the RLS layer — see the keen_africans_articles migration). Published
 * articles are readable by anyone, no login required.
 *
 * `body` is Markdown, rendered through renderArticleBodyHtml() below —
 * NEVER trust/render raw author-supplied HTML (this session's explicit
 * "Must NOT"). This is the one shared template every Keen African's article
 * goes through, so no self-registered author can inject a script tag or
 * spoof another author's page under the keenafrica.com domain.
 */

export class RateLimitedError extends Error {
  constructor(message = "Too many articles created recently — try again later") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export class EmailNotVerifiedError extends Error {
  constructor(message = "Verify your email address before publishing") {
    super(message);
    this.name = "EmailNotVerifiedError";
  }
}

export class ArticleNotFoundError extends Error {
  constructor(message = "Article not found") {
    super(message);
    this.name = "ArticleNotFoundError";
  }
}

/**
 * Session 38 (Keen Africans — Editor Workflow). Thrown by publishArticle()/
 * scheduleArticle() when an article HAS entered the review workflow
 * (reviewStatus !== 'not_submitted') but hasn't reached 'approved' yet.
 * An article that never touches review (the default, direct-publish path)
 * never triggers this — see assertReviewApproved()'s own comment.
 */
export class ReviewNotApprovedError extends Error {
  constructor(message = "This article must be approved by a reviewer before it can be published") {
    super(message);
    this.name = "ReviewNotApprovedError";
  }
}

/** Session 38 (Keen Africans — Editor Workflow). Thrown by submitForReview()/approveArticle()/requestChanges()/rejectArticle() when called from a reviewStatus that doesn't allow the requested transition. */
export class InvalidReviewTransitionError extends Error {
  constructor(message = "That review action isn't valid for this article's current state") {
    super(message);
    this.name = "InvalidReviewTransitionError";
  }
}

/** Session 38 (Keen Africans — Editor Workflow). Thrown by updateArticleSlug() for a malformed or already-taken slug. */
export class InvalidSlugError extends Error {
  constructor(message = "That URL isn't available — try a different one") {
    super(message);
    this.name = "InvalidSlugError";
  }
}

/** Session 38 (Keen Africans — Editor Workflow). Thrown by scheduleArticle() when the requested time isn't in the future. */
export class InvalidScheduleError extends Error {
  constructor(message = "Scheduled publish time must be in the future") {
    super(message);
    this.name = "InvalidScheduleError";
  }
}

// --- Markdown rendering -----------------------------------------------

/**
 * marked() parses Markdown to HTML and, like every Markdown parser, passes
 * inline raw HTML in the source straight through unless told otherwise —
 * that alone is not safe to serve. sanitize-html() is the actual security
 * boundary: it re-parses the resulting HTML against a strict allowlist and
 * drops anything else (script/style tags, on* event attributes,
 * javascript:/data: URLs, iframes, forms, ...), regardless of what marked
 * produced. An author writing `<script>...</script>` in their Markdown
 * source gets it silently stripped, not executed. This two-stage
 * parse-then-allowlist-sanitize pipeline is the one shared rendering path
 * for every article body — src/app/keenafricans's public article page and
 * the author's own edit-mode preview both call this, never anything else.
 */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * A `marked` instance with heading ids added (marked itself dropped built-in
 * heading-id generation years ago) — this is what makes an author's own
 * table-of-contents links (`[Section](#some-heading)`) actually scroll to
 * the right place instead of just landing at the top of the page with a
 * dead fragment in the URL. Slugs are de-duplicated per render (two
 * identically-worded headings in one article both get valid, distinct
 * anchors) — a fresh counter per renderArticleBodyHtml() call, so it never
 * needs resetting between articles.
 */
function markedWithHeadingIds(): Marked {
  const instance = new Marked();
  const seen = new Map<string, number>();
  instance.use({
    renderer: {
      heading({ tokens, depth, text: rawText }) {
        const text = this.parser.parseInline(tokens);
        const base = slugifyHeading(rawText) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
    },
  });
  return instance;
}

/**
 * marked() parses Markdown to HTML and, like every Markdown parser, passes
 * inline raw HTML in the source straight through unless told otherwise —
 * that alone is not safe to serve. sanitize-html() is the actual security
 * boundary: it re-parses the resulting HTML against a strict allowlist and
 * drops anything else (script/style tags, on* event attributes,
 * javascript:/data: URLs, iframes, forms, ...), regardless of what marked
 * produced. An author writing `<script>...</script>` in their Markdown
 * source gets it silently stripped, not executed. This two-stage
 * parse-then-allowlist-sanitize pipeline is the one shared rendering path
 * for every article body — src/app/keenafricans's public article page and
 * the author's own edit-mode preview both call this, never anything else.
 */
export function renderArticleBodyHtml(markdown: string): string {
  const rawHtml = markedWithHeadingIds().parse(markdown, { async: false, gfm: true, breaks: false }) as string;
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "strong", "em", "del", "code", "pre",
      "blockquote",
      "ul", "ol", "li",
      "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    allowedAttributes: {
      h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
      a: ["href", "title", "rel", "target"],
      img: ["src", "alt", "title"],
      code: ["class"],
      th: ["align"],
      td: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      // A same-page table-of-contents link (`href="#section"`) must
      // navigate within the page, not open a new tab — only a genuinely
      // external link (an absolute http(s)/mailto URL) gets target=_blank
      // + rel="noopener noreferrer ugc" (tabnabbing protection). Applied
      // uniformly rather than trusting individual authors to remember it,
      // but only where it actually applies.
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const isSamePage = href.startsWith("#");
        return {
          tagName,
          attribs: isSamePage ? attribs : { ...attribs, rel: "noopener noreferrer ugc", target: "_blank" },
        };
      },
    },
  });
}

/** Plain-text excerpt fallback when an author leaves meta description empty — used for <meta description>/OG tags, never rendered as HTML. */
export function deriveExcerpt(markdown: string, maxLength = 200): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

// --- Slugs --------------------------------------------------------------

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "article";
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let suffix = 1;
  // Slugs are globally unique (across every author, every status) — a
  // short, bounded probe loop is fine here: article creation is already
  // rate-limited (see below), so this can never be driven into a long scan.
  while (true) {
    const existing = await withRls({}, (tx) => tx.article.findUnique({ where: { slug: candidate }, select: { id: true } }));
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PREVIOUS_SLUGS = 10;

/**
 * Session 38 (Keen Africans — Editor Workflow). An author-chosen slug (as
 * opposed to uniqueSlug()'s title-derived, auto-suffixed one above) — this
 * session's brief asks us to decide whether slug editing is allowed at
 * all. Decision: yes, at any article status, with the already-published
 * case handled by recording the old slug in `previousSlugs` (see
 * schema.prisma's Article.previousSlugs comment) so an already-indexed URL
 * 301-redirects instead of 404ing — see resolveRedirectSlug() below and
 * the public article route's use of it.
 */
export async function updateArticleSlug(articleId: string, requestedSlug: string, actor: AuthzActor) {
  const article = await requireArticleOwnerOrManage(articleId, actor);

  const candidate = requestedSlug.trim().toLowerCase();
  if (!SLUG_FORMAT.test(candidate)) {
    throw new InvalidSlugError("URLs can only contain lowercase letters, numbers, and hyphens");
  }
  if (candidate === article.slug) return article;

  const taken = await withRls({}, (tx) =>
    tx.article.findFirst({ where: { slug: candidate, id: { not: articleId } }, select: { id: true } })
  );
  if (taken) throw new InvalidSlugError("That URL is already taken by another article");

  const previousSlugs = Array.from(new Set([...article.previousSlugs, article.slug])).slice(-MAX_PREVIOUS_SLUGS);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({ where: { id: articleId }, data: { slug: candidate, previousSlugs } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.slug_changed",
    entityType: "Article",
    entityId: articleId,
    metadata: { from: article.slug, to: candidate },
  });

  return updated;
}

/**
 * Public, anonymous lookup for the article route's 404 fallback: is this an
 * OLD slug of a still-published article? Returns the current slug to
 * redirect to, or null (genuinely unknown / never published under this
 * slug / the article that used to own it is no longer published).
 */
export async function resolveRedirectSlug(oldSlug: string): Promise<string | null> {
  const article = await withRls({}, (tx) =>
    tx.article.findFirst({
      where: { previousSlugs: { has: oldSlug }, status: "published" },
      select: { slug: true },
    })
  );
  return article?.slug ?? null;
}

// --- Rate limiting (Session 34 abuse-model decision) --------------------
//
// Reuses src/lib/rate-limit.ts's countRecentAuditEvents (audit_events is
// already the shared counter every other limiter in this codebase uses) —
// no new limiter mechanism. Deliberately generous: this guards against
// scripted spam account creation flooding the public listing, not against
// a legitimate prolific writer.
export const ARTICLE_CREATE_WINDOW = { windowMs: 60 * 60 * 1000, maxAttempts: 8 };

async function assertNotRateLimited(actorId: string): Promise<void> {
  const count = await countRecentAuditEvents({
    actions: ["article.created"],
    actorId,
    sinceMs: ARTICLE_CREATE_WINDOW.windowMs,
  });
  if (count >= ARTICLE_CREATE_WINDOW.maxAttempts) {
    throw new RateLimitedError();
  }
}

// --- Ownership -------------------------------------------------------

async function requireArticleOwnerOrManage(articleId: string, actor: AuthzActor) {
  const article = await withRls(actorRlsCtx(actor), (tx) => tx.article.findUnique({ where: { id: articleId } }));
  if (!article) throw new ArticleNotFoundError();
  const isOwner = article.authorId === actor.id && hasPermission(actor, PERMISSIONS.ARTICLES_WRITE);
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE) && !isOwner) {
    throw new AuthorizationError("Not authorized");
  }
  return article;
}

// --- Author-facing CRUD -------------------------------------------------

/**
 * Session 38 (Keen Africans — Editor Workflow). The curated Topic list —
 * see schema.prisma's ArticleTopic comment for why this is its own small
 * enum, not Education Core's Topic/Skill table. To extend it: add a new
 * migration (`ALTER TYPE "ArticleTopic" ADD VALUE '...'`, its own
 * migration/transaction — same enum-value restriction every other value
 * addition in this codebase hits) and add the label below; nothing else
 * needs to change (the editor/admin UI both render off this map).
 */
export const ARTICLE_TOPIC_LABELS: Record<ArticleTopic, string> = {
  cloud: "Cloud",
  ai: "AI",
  engineering: "Engineering",
  entrepreneurship: "Entrepreneurship",
  career: "Career",
  business: "Business",
  culture: "Culture",
};
export const ARTICLE_TOPICS = Object.keys(ARTICLE_TOPIC_LABELS) as ArticleTopic[];

export interface CreateArticleInput {
  title: string;
  body?: string;
  excerpt?: string;
  tags?: string[];
  topic?: ArticleTopic | null;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(
    new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).map((t) => t.slice(0, 40)))
  ).slice(0, 12);
}

export async function createArticle(input: CreateArticleInput, actor: AuthzActor) {
  if (!hasPermission(actor, PERMISSIONS.ARTICLES_WRITE) && !actor.isSuperAdmin) {
    throw new AuthorizationError("Not authorized");
  }
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");

  await assertNotRateLimited(actor.id);
  const slug = await uniqueSlug(title);
  // Snapshot, not a live join — see schema.prisma's Article.authorName
  // comment. Resolved once, here, at creation time only.
  const authorName = await resolveAuthorName(actor);

  const article = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.create({
      data: {
        authorId: actor.id,
        title,
        slug,
        body: input.body ?? "",
        excerpt: input.excerpt?.trim() || null,
        tags: normalizeTags(input.tags),
        topic: input.topic ?? null,
        authorName,
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.created", entityType: "Article", entityId: article.id });

  return article;
}

export interface UpdateArticleInput {
  title?: string;
  topic?: ArticleTopic | null;
  body?: string;
  excerpt?: string;
  tags?: string[];
}

export async function updateArticle(articleId: string, input: UpdateArticleInput, actor: AuthzActor) {
  await requireArticleOwnerOrManage(articleId, actor);

  const article = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt.trim() || null } : {}),
        ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.updated", entityType: "Article", entityId: articleId });
  return article;
}

/**
 * Session 38 (Keen Africans — Editor Workflow). Gate shared by
 * publishArticle() and scheduleArticle(): an article that never entered
 * the review workflow (reviewStatus still 'not_submitted', the default)
 * publishes exactly as it always has — no gate at all, which is what
 * keeps direct-publish available as the default for every Keen African
 * (confirmed with the site owner rather than assumed — see
 * docs/KEEN_AFRICANS.md). An article that HAS entered review must reach
 * 'approved' before a plain author can publish it; articles.manage/
 * super_admin bypass this exactly like they bypass the email-verification
 * gate below (an admin can always publish on someone's behalf).
 */
function assertReviewApproved(article: { reviewStatus: string }, actor: AuthzActor): void {
  if (actor.isSuperAdmin || hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) return;
  if (article.reviewStatus !== "not_submitted" && article.reviewStatus !== "approved") {
    throw new ReviewNotApprovedError();
  }
}

/**
 * The email-verification gate (Session 34's abuse-model decision — module
 * header). Exported (not module-private) because Session 43 (Comments &
 * Reactions) reuses this EXACT function — same bypasses (isSuperAdmin,
 * articles.manage), same error type — for its own "only a logged-in,
 * email-verified Keen African may comment or react" rule, per that
 * session's own explicit "reuse the same email-verification gate" brief.
 * Not renamed to something publish-specific for that reason.
 */
export async function assertEmailVerified(actor: AuthzActor): Promise<void> {
  const user = await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.findUnique({ where: { id: actor.id }, select: { emailVerifiedAt: true } })
  );
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE) && !user?.emailVerifiedAt) {
    throw new EmailNotVerifiedError();
  }
}

/** Self-service publish. Requires a verified email — see this session's abuse-model decision (module header) — and, for an article that entered the review workflow, an 'approved' reviewStatus (see assertReviewApproved()). */
export async function publishArticle(articleId: string, actor: AuthzActor) {
  const article = await requireArticleOwnerOrManage(articleId, actor);
  assertReviewApproved(article, actor);
  await assertEmailVerified(actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      // scheduledAt cleared: an immediate publish supersedes any pending
      // schedule — see schema.prisma's Article.scheduledAt comment.
      data: { status: "published", publishedAt: new Date(), scheduledAt: null },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.published", entityType: "Article", entityId: articleId });
  return updated;
}

/**
 * Session 38 (Keen Africans — Editor Workflow). Publish-at-a-future-time.
 * Same authorization/verification/review gates as immediate publish above
 * (this IS a publish, just a deferred one) — status stays 'draft' (so the
 * article is NOT yet publicly visible) until flipDueScheduledArticles()
 * below flips it once scheduledAt is due. See that function's own comment
 * for why an on-read check, not a cron job, is this codebase's mechanism
 * here (no job-runner convention exists to reuse).
 */
export async function scheduleArticle(articleId: string, scheduledAt: Date, actor: AuthzActor) {
  if (scheduledAt.getTime() <= Date.now()) {
    throw new InvalidScheduleError();
  }
  const article = await requireArticleOwnerOrManage(articleId, actor);
  assertReviewApproved(article, actor);
  await assertEmailVerified(actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({ where: { id: articleId }, data: { scheduledAt } })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.publish_scheduled",
    entityType: "Article",
    entityId: articleId,
    metadata: { scheduledAt: scheduledAt.toISOString() },
  });
  return updated;
}

/** Session 38 (Keen Africans — Editor Workflow). Cancels a pending scheduled publish set by scheduleArticle() above — a no-op if none is pending. */
export async function cancelScheduledPublish(articleId: string, actor: AuthzActor) {
  const article = await requireArticleOwnerOrManage(articleId, actor);
  if (!article.scheduledAt) return article;

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({ where: { id: articleId }, data: { scheduledAt: null } })
  );
  await recordAuditEvent({ actorId: actor.id, action: "article.publish_schedule_cancelled", entityType: "Article", entityId: articleId });
  return updated;
}

/**
 * Session 38 (Keen Africans — Editor Workflow). The "on-read check" this
 * session's brief explicitly allows in place of a cron/job-runner (this
 * codebase has none to reuse — see docs/KEEN_AFRICANS.md). Flips any
 * article whose scheduledAt has arrived from draft to published, under a
 * synthesized system context carrying only articles.manage (never a real
 * actor's own permission set — same "narrow system context" shape
 * certificates.ts's systemCertificateCtx()/progress.ts's
 * systemProgressCtx() already use), since the caller triggering this check
 * (an anonymous public read, or another author's own dashboard load) has
 * no ownership relationship to whichever articles happen to be due.
 * Called from every public/author read path below. Cheap on the common
 * case (zero due rows) thanks to the (status, scheduled_at) index.
 */
function systemArticlesCtx() {
  return { isSuperAdmin: false, permissions: [PERMISSIONS.ARTICLES_MANAGE] };
}

export async function flipDueScheduledArticles(): Promise<void> {
  const due = await withRls(systemArticlesCtx(), (tx) =>
    tx.article.findMany({
      where: { status: "draft", scheduledAt: { lte: new Date() } },
      select: { id: true, authorId: true, scheduledAt: true },
    })
  );
  if (due.length === 0) return;

  await withRls(systemArticlesCtx(), (tx) =>
    Promise.all(
      due.map((a) =>
        tx.article.update({
          where: { id: a.id },
          data: { status: "published", publishedAt: a.scheduledAt!, scheduledAt: null },
        })
      )
    )
  );

  await Promise.all(
    due.map((a) =>
      recordAuditEvent({
        actorId: a.authorId,
        action: "article.published",
        entityType: "Article",
        entityId: a.id,
        metadata: { scheduled: true },
      })
    )
  );
}

/** Self-service — returns a published article to draft. Distinct from adminUnpublishArticle below (moderation). */
export async function unpublishArticle(articleId: string, actor: AuthzActor) {
  await requireArticleOwnerOrManage(articleId, actor);

  const article = await withRls(actorRlsCtx(actor), (tx) =>
    // scheduledAt cleared defensively — an already-published article
    // shouldn't carry a stale pending-schedule value.
    tx.article.update({ where: { id: articleId }, data: { status: "draft", scheduledAt: null } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.unpublished", entityType: "Article", entityId: articleId });
  return article;
}

/** Self-service soft-delete — terminal from the author's own dashboard, but never a hard row DELETE (no DELETE RLS policy exists at all). */
export async function archiveArticle(articleId: string, actor: AuthzActor) {
  await requireArticleOwnerOrManage(articleId, actor);

  const article = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({ where: { id: articleId }, data: { status: "archived" } })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.archived", entityType: "Article", entityId: articleId });
  return article;
}

// --- Review workflow (Session 38 — Editor Workflow) ----------------------
//
// Entirely OPT-IN: an article's reviewStatus starts and stays
// 'not_submitted' unless its own author calls submitForReview() — nothing
// here runs automatically, and publishArticle()'s direct-publish path
// keeps working unchanged for an article that never does (see
// assertReviewApproved() above). Reviewer actions (approve/reject/request
// changes) require articles.manage, same key as adminUnpublishArticle
// below and the same "no KEEN_AFRICAN/TEACHER/STUDENT role holds it"
// guarantee — a plain author can never approve their own or anyone else's
// article. Every transition is audited, same standard as every other
// moderation-adjacent action in this codebase.
//
// State machine:
//   not_submitted -> in_review               (submitForReview, author)
//   in_review     -> approved                (approveArticle, articles.manage)
//   in_review     -> changes_requested        (requestChanges, articles.manage)
//   in_review     -> rejected                 (rejectArticle, articles.manage)
//   changes_requested -> in_review            (submitForReview again, author)
//   rejected      -> in_review                (submitForReview again, author)
//   approved      -> (publishArticle/scheduleArticle succeed for the author)

/** Author submits a draft for review — from 'not_submitted' (first submission) or 'changes_requested'/'rejected' (resubmission after revising). */
export async function submitForReview(articleId: string, actor: AuthzActor) {
  const article = await requireArticleOwnerOrManage(articleId, actor);
  if (article.status !== "draft") {
    throw new InvalidReviewTransitionError("Only a draft article can be submitted for review");
  }
  if (!["not_submitted", "changes_requested", "rejected"].includes(article.reviewStatus)) {
    throw new InvalidReviewTransitionError();
  }

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: { reviewStatus: "in_review", reviewNote: null, reviewedAt: null, reviewedBy: null },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.review_submitted", entityType: "Article", entityId: articleId });
  return updated;
}

async function requireInReview(articleId: string, actor: AuthzActor) {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) {
    throw new AuthorizationError("Not authorized");
  }
  const article = await withRls(actorRlsCtx(actor), (tx) => tx.article.findUnique({ where: { id: articleId } }));
  if (!article) throw new ArticleNotFoundError();
  if (article.reviewStatus !== "in_review") {
    throw new InvalidReviewTransitionError("This article isn't awaiting review");
  }
  return article;
}

/** Reviewer (articles.manage) approves an in-review article. Does NOT publish it — the author (or the reviewer, who also holds publish rights) still calls publishArticle()/scheduleArticle() explicitly. */
export async function approveArticle(articleId: string, actor: AuthzActor) {
  const article = await requireInReview(articleId, actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: { reviewStatus: "approved", reviewNote: null, reviewedAt: new Date(), reviewedBy: actor.id },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.review_approved",
    entityType: "Article",
    entityId: articleId,
    metadata: { authorId: article.authorId },
  });
  return updated;
}

/** Reviewer (articles.manage) sends an in-review article back to the author with a required note. Author edits and resubmits via submitForReview(). */
export async function requestChanges(articleId: string, note: string, actor: AuthzActor) {
  const trimmed = note.trim();
  if (!trimmed) throw new Error("A note is required so the author knows what to change");
  const article = await requireInReview(articleId, actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: { reviewStatus: "changes_requested", reviewNote: trimmed, reviewedAt: new Date(), reviewedBy: actor.id },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.review_changes_requested",
    entityType: "Article",
    entityId: articleId,
    metadata: { authorId: article.authorId, note: trimmed },
  });
  return updated;
}

/** Reviewer (articles.manage) rejects an in-review article with a required reason. Author may still revise and resubmit — rejection is not terminal (see the state machine comment above). */
export async function rejectArticle(articleId: string, reason: string, actor: AuthzActor) {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to reject an article");
  const article = await requireInReview(articleId, actor);

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: { reviewStatus: "rejected", reviewNote: trimmed, reviewedAt: new Date(), reviewedBy: actor.id },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.review_rejected",
    entityType: "Article",
    entityId: articleId,
    metadata: { authorId: article.authorId, reason: trimmed },
  });
  return updated;
}

/** Reviewer queue — every author's in-review articles. Mirrors listAllPublishedArticlesForAdmin()'s shape below. */
export async function listArticlesPendingReview(actor: AuthzActor) {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) {
    throw new AuthorizationError("Not authorized");
  }
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.article.findMany({
      where: { reviewStatus: "in_review" },
      orderBy: { updatedAt: "asc" },
      include: { author: { select: { id: true, name: true, email: true } } },
    })
  );
}

/**
 * The Admin/Troubleshooter moderation safety valve this session's brief
 * requires — the acceptable alternative to pre-publish review. Requires
 * articles.manage (ADMIN/SUPER_ADMIN only — no KEEN_AFRICAN/TEACHER/STUDENT
 * role holds it, see DEFAULT_ROLE_PERMISSIONS). Takes a published article
 * back to draft (not archived — the author keeps their draft and can
 * address the concern and republish; archiving is the author's own
 * decision, not implied by a moderation action) and records who/why both on
 * the row (for the author's own dashboard) and in AuditEvent (the
 * platform's actual audit trail).
 */
export async function adminUnpublishArticle(articleId: string, actor: AuthzActor, reason: string) {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) {
    throw new AuthorizationError("Not authorized");
  }
  const article = await withRls(actorRlsCtx(actor), (tx) => tx.article.findUnique({ where: { id: articleId } }));
  if (!article) throw new ArticleNotFoundError();

  const updated = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: {
        status: "draft",
        moderatedAt: new Date(),
        moderatedBy: actor.id,
        moderationNote: reason.trim() || null,
      },
    })
  );

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.unpublished_by_admin",
    entityType: "Article",
    entityId: articleId,
    metadata: { authorId: article.authorId, reason },
  });

  // Session 39 (Keen Africans — Notifications). This safety valve
  // previously emitted no domain event at all, so its author never learned
  // their article came down beyond noticing it themselves on their own
  // dashboard. notifications.ts's listener re-fetches moderatedAt itself
  // (same "listener re-fetches under its own RLS context" convention every
  // other listener in that file follows) to derive its dedupeKey.
  emitDomainEvent("ArticleUnpublishedByAdmin", { articleId, authorId: article.authorId, actorId: actor.id });

  return updated;
}

// --- Cover image (Asset service reuse) -----------------------------------

export interface SetCoverImageInput {
  originalFilename: string;
  declaredMimeType: string;
  buffer: Buffer;
}

export async function setCoverImage(articleId: string, input: SetCoverImageInput, actor: AuthzActor) {
  const article = await requireArticleOwnerOrManage(articleId, actor);

  const asset = await uploadAsset(
    { originalFilename: input.originalFilename, declaredMimeType: input.declaredMimeType, buffer: input.buffer },
    actor
  );

  try {
    await withRls(actorRlsCtx(actor), async (tx) => {
      // An article carries at most one cover — detach the previous one (if
      // any) in the same transaction as attaching the new one.
      await tx.assetAttachment.deleteMany({ where: { entityType: "article_cover", entityId: articleId } });
      await tx.assetAttachment.create({
        data: { assetId: asset.id, entityType: "article_cover", entityId: articleId, attachedBy: actor.id },
      });
      await tx.article.update({ where: { id: articleId }, data: { coverAssetId: asset.id } });
    });
  } catch (err) {
    await deleteAssetIfOrphanedAsContentOwner(asset.id, actor).catch(() => {});
    throw err;
  }

  if (article.coverAssetId) {
    await deleteAssetIfOrphanedAsContentOwner(article.coverAssetId, actor).catch(() => {});
  }

  await recordAuditEvent({
    actorId: actor.id,
    action: "article.cover_set",
    entityType: "Article",
    entityId: articleId,
    metadata: { assetId: asset.id },
  });

  return asset;
}

export async function removeCoverImage(articleId: string, actor: AuthzActor) {
  const article = await requireArticleOwnerOrManage(articleId, actor);
  if (!article.coverAssetId) return;

  await withRls(actorRlsCtx(actor), async (tx) => {
    await tx.assetAttachment.deleteMany({ where: { entityType: "article_cover", entityId: articleId } });
    await tx.article.update({ where: { id: articleId }, data: { coverAssetId: null } });
  });

  await deleteAssetIfOrphanedAsContentOwner(article.coverAssetId, actor).catch(() => {});
  await recordAuditEvent({ actorId: actor.id, action: "article.cover_removed", entityType: "Article", entityId: articleId });
}

// --- Reads ----------------------------------------------------------

/** Author's own dashboard — every status, own articles only (or any author's, for articles.manage/super_admin). */
export async function listMyArticles(actor: AuthzActor) {
  await flipDueScheduledArticles();
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.article.findMany({ where: { authorId: actor.id }, orderBy: { updatedAt: "desc" } })
  );
}

/**
 * Session 41 (Admin Moderation, Reporting & Verification Review). The real
 * filterable moderation queue, replacing Session 34's flat "every
 * published article" list (listAllPublishedArticlesForAdmin, removed —
 * nothing else referenced it). Two independent filter dimensions, per this
 * session's own acceptance criteria ("filtering by status AND by
 * reported-vs-not"):
 *
 *  - `status`: 'pending_review' (reviewStatus = in_review — the same set
 *    listArticlesPendingReview() returns, queried directly here rather
 *    than delegating to it, since that function is its own tested,
 *    independent reviewer-queue contract, not a moderation-queue internal);
 *    'published' (status = published); 'rejected' (reviewStatus =
 *    rejected — an author's review submission a reviewer sent back, not
 *    the post-publish admin-unpublish safety valve below, which returns
 *    an article to 'draft' with no reviewStatus change and stays visible
 *    only on the author's own dashboard, unchanged from Session 34).
 *    Omitted: the union of all three buckets — never drafts that were
 *    never submitted for review and never published, same as before.
 *  - `reportedOnly`: intersects with src/lib/reports.ts's
 *    getOpenReportEntityIds('article', actor) regardless of which status
 *    bucket (or no bucket) is selected.
 *
 * Every returned row also carries `reported: boolean` so the UI can badge
 * a reported article even when reportedOnly isn't the active filter.
 */
export type ArticleModerationStatus = "pending_review" | "published" | "rejected";

export interface ListArticlesForModerationFilter {
  status?: ArticleModerationStatus;
  reportedOnly?: boolean;
}

const MODERATION_STATUS_WHERE: Record<ArticleModerationStatus, Record<string, unknown>> = {
  pending_review: { reviewStatus: "in_review" },
  published: { status: "published" },
  rejected: { reviewStatus: "rejected" },
};

export async function listArticlesForModeration(actor: AuthzActor, filter: ListArticlesForModerationFilter = {}) {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) {
    throw new AuthorizationError("Not authorized");
  }
  await flipDueScheduledArticles();

  const statusWhere = filter.status
    ? MODERATION_STATUS_WHERE[filter.status]
    : { OR: Object.values(MODERATION_STATUS_WHERE) };

  const reportedIds = await getOpenReportEntityIds("article", actor);
  if (filter.reportedOnly && reportedIds.size === 0) return [];

  const rows = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.findMany({
      where: {
        ...statusWhere,
        ...(filter.reportedOnly ? { id: { in: Array.from(reportedIds) } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: { author: { select: { id: true, name: true, email: true } } },
    })
  );

  return rows.map((a) => ({ ...a, reported: reportedIds.has(a.id) }));
}

/** Admin view of one author's articles across every status (draft/in-review/published/archived) — the "view a user's articles from the admin side" surface. Requires articles.manage. */
export async function listArticlesByAuthorForAdmin(authorId: string, actor: AuthzActor) {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) {
    throw new AuthorizationError("Not authorized");
  }
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.article.findMany({ where: { authorId }, orderBy: { updatedAt: "desc" } })
  );
}

export async function getArticleForEdit(articleId: string, actor: AuthzActor) {
  await flipDueScheduledArticles();
  return requireArticleOwnerOrManage(articleId, actor);
}

// --- Public reads (no actor — anonymous, published-only) -----------------

const PUBLIC_PAGE_SIZE = 20;

/**
 * Session 36 replaced the elevated-context authorNamesByIds() workaround
 * this comment used to describe (a narrow `withRls({ isSuperAdmin: true })`
 * read of "users.name", needed because users_select has no anonymous
 * branch) with two changes: authorName is now a denormalized snapshot
 * column set once at article creation (see createArticle() above and
 * schema.prisma's Article.authorName comment), so no per-read query is
 * needed for the display name at all; and the profile-link username below
 * comes from src/lib/profiles.ts's getUsernamesByUserIds(), which reads
 * the "profiles" table (unconditionally public — see the
 * keen_africans_profiles_core migration) instead of "users", so it needs
 * no elevation either. The elevated-context pattern is fully removed from
 * this file, not left coexisting with the new mechanism.
 */
/**
 * Session 40 (Keen Africans — LinkedIn Verification). Two independent
 * public badges — see the two page components' badge slot for the
 * precedence rule (verified supersedes the plain "Keen African" label,
 * never both at once). Session 44 (Discovery) pulled this out of
 * listPublishedArticles()/getPublicArticleBySlug() into one shared helper
 * so listTrendingArticles() and listArticlesByTopic() below (and
 * src/lib/search.ts's searchArticles()) can reuse the exact same
 * author-info shape instead of re-deriving it.
 */
async function attachPublicAuthorInfo<T extends { authorId: string; authorName: string }>(
  articles: T[]
): Promise<Array<T & { author: { name: string; username: string | null; member: boolean; verified: boolean } }>> {
  const authorIds = articles.map((a) => a.authorId);
  const [usernames, memberIds, verifiedIds] = await Promise.all([
    getUsernamesByUserIds(authorIds),
    getMemberLabelUserIds(authorIds),
    getVerifiedUserIds(authorIds),
  ]);
  return articles.map((a) => ({
    ...a,
    author: {
      name: a.authorName,
      username: usernames.get(a.authorId) ?? null,
      member: memberIds.has(a.authorId),
      verified: verifiedIds.has(a.authorId),
    },
  }));
}

export async function listPublishedArticles(opts: { page?: number; tag?: string; topic?: ArticleTopic } = {}) {
  await flipDueScheduledArticles();
  const page = Math.max(1, opts.page ?? 1);
  const where = {
    status: "published" as const,
    ...(opts.tag ? { tags: { has: opts.tag.trim().toLowerCase() } } : {}),
    ...(opts.topic ? { topic: opts.topic } : {}),
  };

  const [articles, total] = await withRls({}, (tx) =>
    Promise.all([
      tx.article.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * PUBLIC_PAGE_SIZE,
        take: PUBLIC_PAGE_SIZE,
      }),
      tx.article.count({ where }),
    ])
  );

  const withAuthor = await attachPublicAuthorInfo(articles);
  return { articles: withAuthor, total, page, pageSize: PUBLIC_PAGE_SIZE };
}

/** Public article page — published only, no login. Returns null for anything else (draft/archived/unknown slug) so the route can 404 uniformly rather than leaking existence. */
export async function getPublicArticleBySlug(slug: string) {
  await flipDueScheduledArticles();
  const article = await withRls({}, (tx) => tx.article.findFirst({ where: { slug, status: "published" } }));
  if (!article) return null;

  const [withAuthor] = await attachPublicAuthorInfo([article]);
  return withAuthor;
}

// --- Discovery (Session 44) ----------------------------------------------
//
// Trending/Topics browsing — see recordArticleView()/ArticleView's own
// comments for the view-tracking half of this session. "Latest" needs no
// new function at all: listPublishedArticles() above, called with no
// filter, already IS "latest published, newest first" — the Explore page
// just calls it with a small limit for its teaser section and links to the
// existing full paginated listing for "see all."

/**
 * Published article counts per Session 38's curated ArticleTopic, for the
 * Explore page's "Topics" section. Zero-filled for every topic (not just
 * the ones with at least one article) so the UI can render a stable list
 * without special-casing an empty topic.
 */
export async function getTopicCounts(): Promise<Record<ArticleTopic, number>> {
  await flipDueScheduledArticles();
  const rows = await withRls({}, (tx) =>
    tx.article.groupBy({
      by: ["topic"],
      where: { status: "published", topic: { not: null } },
      _count: { _all: true },
    })
  );
  const counts = Object.fromEntries(ARTICLE_TOPICS.map((t) => [t, 0])) as Record<ArticleTopic, number>;
  for (const row of rows) {
    if (row.topic) counts[row.topic] = row._count._all;
  }
  return counts;
}

const TRENDING_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h — "recent," not lifetime.
const TRENDING_CANDIDATE_POOL = 50; // wide enough that filtering out a since-unpublished article rarely starves the result.

/**
 * Trending — ranked by RECENT view velocity (views in the last 48h), never
 * lifetime Article.viewCount, so a new article can surface instead of being
 * permanently buried under an old one's accumulated total (this session's
 * own explicit rule). Backed by ArticleView (see that model's own comment),
 * not Article.viewCount.
 *
 * Two-step, not one join: group ArticleView by article for a candidate
 * pool (cheap, indexed on (article_id, viewed_at)), then re-fetch those
 * articles filtered to CURRENTLY published — an article that accrued views
 * while published and was since unpublished/archived (self-service or the
 * admin safety valve) must never appear here even though its view rows
 * still exist. This is an approximation, not a live join: if enough
 * top-ranked candidates in the pool got filtered out, the true 51st-most-
 * viewed article might be missed. Acceptable for this session's "simple
 * v1" scope — see docs/KEEN_AFRICANS.md's "Known limitations."
 */
export async function listTrendingArticles(limit = 5) {
  await flipDueScheduledArticles();
  const since = new Date(Date.now() - TRENDING_WINDOW_MS);

  const grouped = await withRls({}, (tx) =>
    tx.articleView.groupBy({
      by: ["articleId"],
      where: { viewedAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { articleId: "desc" } },
      take: TRENDING_CANDIDATE_POOL,
    })
  );
  if (grouped.length === 0) return [];

  const viewsByArticleId = new Map(grouped.map((g) => [g.articleId, g._count._all]));
  const articles = await withRls({}, (tx) =>
    tx.article.findMany({ where: { id: { in: [...viewsByArticleId.keys()] }, status: "published" } })
  );

  const withAuthor = await attachPublicAuthorInfo(articles);
  return withAuthor
    .map((a) => ({ ...a, viewsInWindow: viewsByArticleId.get(a.id) ?? 0 }))
    .sort((a, b) => b.viewsInWindow - a.viewsInWindow)
    .slice(0, limit);
}

/**
 * Session 44 (Discovery, Search & Recommendations). Derives the dedup key
 * recordArticleView() below uses to decide "is this the same viewer again,
 * soon" — NEVER a raw IP address (see ArticleView's own schema.prisma
 * comment): a signed-in viewer is keyed on their stable user id; an
 * anonymous one is keyed on a salted sha256 of IP+User-Agent, so this
 * value can never be reversed back into an identifiable IP by anyone who
 * only has DB access. Salted with AUTH_SECRET (already this codebase's one
 * server-only secret — see auth.ts) purely so the hash isn't trivially
 * reproducible client-side; this is an abuse-resistance measure, not a
 * cryptographic identity claim.
 *
 * Callers with nothing to key on (no session, no headers — e.g. a script)
 * may omit every field; recordArticleView() then falls back to its own
 * "no dedup" behavior, unchanged from Session 42 — see that function's own
 * comment.
 */
export function hashViewerKey(input: { userId?: string | null; ipAddress?: string | null; userAgent?: string | null }): string {
  if (input.userId) return `user:${input.userId}`;
  if (!input.ipAddress && !input.userAgent) return "";
  const secret = process.env.AUTH_SECRET ?? "";
  const raw = `${input.ipAddress ?? "unknown"}|${input.userAgent ?? "unknown"}`;
  return `anon:${createHash("sha256").update(`${secret}:${raw}`).digest("hex")}`;
}

const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Session 42 (Follow & Author Reputation Display) / extended by Session 44
 * (Discovery, Search & Recommendations) — see schema.prisma's
 * Article.viewCount and ArticleView comments for the full mechanism this
 * extends rather than duplicates.
 *
 * Deliberately a SEPARATE call from getPublicArticleBySlug() above, not a
 * side effect folded into that read: the public article page calls
 * getPublicArticleBySlug() twice per real visit (once from
 * generateMetadata(), once from the page component body — a pre-existing
 * pattern, not introduced by this session), and folding the increment into
 * the read would double-count a single page view. Callers must call this
 * exactly once, from the page component body only.
 *
 * `viewerKey` (see hashViewerKey() above) is OPTIONAL and, when supplied,
 * ADDS a lightweight dedup: a repeat view from the same viewer within
 * VIEW_DEDUPE_WINDOW_MS is silently skipped (no viewCount increment, no
 * new ArticleView row) — this session's own "must not be trivially
 * gameable" rule, without turning this into a hardened analytics system
 * (still no login/cookie requirement, still resettable by a new IP/browser
 * — see docs/KEEN_AFRICANS.md's "Known limitations"). Omitting viewerKey
 * entirely preserves Session 42's original behavior exactly: every call
 * counts, no dedup — every pre-existing caller/test keeps working
 * unchanged.
 *
 * Reuses the existing systemArticlesCtx() (articles.manage, no real actor)
 * — the same narrow system context flipDueScheduledArticles() already uses
 * for anonymous-driven writes to this table — rather than inventing a new
 * elevated-write mechanism. Best-effort: a failure here must never break
 * the page render itself, same "catch and log, don't let a side effect
 * break the primary request" convention src/lib/events.ts's
 * onDomainEvent() already establishes.
 */
export async function recordArticleView(articleId: string, viewerKey?: string): Promise<void> {
  try {
    if (viewerKey) {
      const recent = await withRls(systemArticlesCtx(), (tx) =>
        tx.articleView.findFirst({
          where: { articleId, viewerKey, viewedAt: { gte: new Date(Date.now() - VIEW_DEDUPE_WINDOW_MS) } },
          select: { id: true },
        })
      );
      if (recent) return;
    }

    await withRls(systemArticlesCtx(), async (tx) => {
      await tx.article.update({ where: { id: articleId }, data: { viewCount: { increment: 1 } } });
      // A caller that supplied no viewerKey still gets an ArticleView row
      // (a fresh, never-reused synthetic key) so listTrendingArticles()
      // still sees the view — only the dedup CHECK above is skipped when
      // no key is supplied, not the log entry itself.
      await tx.articleView.create({ data: { articleId, viewerKey: viewerKey || `anon:${randomUUID()}` } });
    });
  } catch (err) {
    console.error("[articles] recordArticleView failed", err);
  }
}

/**
 * Public, unauthenticated cover-image bytes for a published article — the
 * one deliberate exception to every other Asset download route in this
 * codebase requiring a real AuthzActor. Safe specifically because
 * asset_attachments_select/assets_select's RLS policies (keen_africans_
 * asset_attachments migration) already restrict an anonymous
 * (empty-app.user_id) read to exactly the article_cover rows whose owning
 * article is published — withRls({}) here carries no more access than that.
 * Returns null for anything else (unattached, draft/archived article,
 * unknown id), so the caller can 404 uniformly.
 */
export async function getPublicArticleCoverBytes(
  assetId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const attachment = await withRls({}, (tx) =>
    tx.assetAttachment.findFirst({ where: { assetId, entityType: "article_cover" }, select: { id: true } })
  );
  if (!attachment) return null;

  const asset = await withRls({}, (tx) => tx.asset.findUnique({ where: { id: assetId } }));
  if (!asset || asset.status === "deleted") return null;

  const buffer = await getStorageDriver().get(asset.storageKey);
  return { buffer, mimeType: asset.mimeType };
}

// --- Account deletion (Session 37) ---------------------------------------

/**
 * The site owner's explicit deletion policy (sessions/37-keen-africans-
 * account-security.md): deleting a Keen African's account anonymizes it —
 * published articles are NOT removed, they stay live under the anonymized
 * attribution. This is the one real entry point for that, orchestrating
 * three modules' own self-scoped mutations in a deliberate order:
 *
 * 1. Reattribute the caller's own articles (this module — below).
 * 2. Scrub the caller's Profile (src/lib/profiles.ts's
 *    anonymizeOwnProfile()).
 * 3. src/lib/users.ts's anonymizeOwnAccount() — the actual point of no
 *    return: password/email wiped, every session and linked OAuth identity
 *    killed. Called LAST, on purpose — steps 1-2 are plain self-scoped
 *    writes on rows this account still fully controls; if either of them
 *    were to fail, nothing irreversible has happened yet and the caller can
 *    just retry. Reversing the order would risk the opposite: an account
 *    already locked out, with articles never actually reattributed.
 *
 * Lives here (not in users.ts, which stays fully portal-agnostic — see its
 * own comment on anonymizeOwnAccount()) because this module already
 * imports src/lib/profiles.ts (createArticle()'s resolveAuthorName()), so
 * this direction of dependency (articles.ts -> profiles.ts, articles.ts ->
 * users.ts) adds no new edge; profiles.ts importing articles.ts the other
 * way would.
 */
export const DELETED_ACCOUNT_NAME = "Former Keen African";

export async function deleteOwnKeenAfricanAccount(actor: AuthzActor): Promise<void> {
  // Checked FIRST, before any mutation — a blocked attempt (stale step-up,
  // a privileged account) must be a true no-op, not "articles/profile
  // already scrubbed, account itself untouched." See
  // assertOwnAccountDeletable()'s own comment.
  await assertOwnAccountDeletable(actor);

  await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.updateMany({ where: { authorId: actor.id }, data: { authorName: DELETED_ACCOUNT_NAME } })
  );

  await anonymizeOwnProfile(actor, DELETED_ACCOUNT_NAME);

  // The actual point of no return — see this function's own header comment
  // for why it runs last, and assertOwnAccountDeletable()'s own comment for
  // why re-checking here too is deliberate, not redundant waste.
  await anonymizeOwnAccount(actor, { anonymizedName: DELETED_ACCOUNT_NAME });
}
