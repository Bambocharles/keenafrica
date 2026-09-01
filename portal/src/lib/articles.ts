import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { withRls } from "@/lib/rls";
import { AuthorizationError, PERMISSIONS, hasPermission, type AuthzActor } from "@/lib/authz";
import { recordAuditEvent } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { actorRlsCtx } from "@/lib/courses";
import { countRecentAuditEvents } from "@/lib/rate-limit";
import { uploadAsset, deleteAssetIfOrphanedAsContentOwner } from "@/lib/assets";
import { getStorageDriver } from "@/lib/storage";
import { resolveAuthorName, getUsernamesByUserIds, anonymizeOwnProfile } from "@/lib/profiles";
import { anonymizeOwnAccount, assertOwnAccountDeletable } from "@/lib/users";

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

export interface CreateArticleInput {
  title: string;
  body?: string;
  excerpt?: string;
  tags?: string[];
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
        authorName,
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.created", entityType: "Article", entityId: article.id });

  return article;
}

export interface UpdateArticleInput {
  title?: string;
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
      },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.updated", entityType: "Article", entityId: articleId });
  return article;
}

/** Self-service publish. Requires a verified email — see this session's abuse-model decision (module header). */
export async function publishArticle(articleId: string, actor: AuthzActor) {
  await requireArticleOwnerOrManage(articleId, actor);

  const user = await withRls(actorRlsCtx(actor), (tx) =>
    tx.user.findUnique({ where: { id: actor.id }, select: { emailVerifiedAt: true } })
  );
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE) && !user?.emailVerifiedAt) {
    throw new EmailNotVerifiedError();
  }

  const article = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({
      where: { id: articleId },
      data: { status: "published", publishedAt: new Date() },
    })
  );

  await recordAuditEvent({ actorId: actor.id, action: "article.published", entityType: "Article", entityId: articleId });
  return article;
}

/** Self-service — returns a published article to draft. Distinct from adminUnpublishArticle below (moderation). */
export async function unpublishArticle(articleId: string, actor: AuthzActor) {
  await requireArticleOwnerOrManage(articleId, actor);

  const article = await withRls(actorRlsCtx(actor), (tx) =>
    tx.article.update({ where: { id: articleId }, data: { status: "draft" } })
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
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.article.findMany({ where: { authorId: actor.id }, orderBy: { updatedAt: "desc" } })
  );
}

/** Admin moderation queue — every author's published articles (today's minimal "queue": a flat published list; see docs/KEEN_AFRICANS.md's deferred-to-v2 note on a richer queue). */
export async function listAllPublishedArticlesForAdmin(actor: AuthzActor) {
  if (!actor.isSuperAdmin && !hasPermission(actor, PERMISSIONS.ARTICLES_MANAGE)) {
    throw new AuthorizationError("Not authorized");
  }
  return withRls(actorRlsCtx(actor), (tx) =>
    tx.article.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
      include: { author: { select: { id: true, name: true, email: true } } },
    })
  );
}

export async function getArticleForEdit(articleId: string, actor: AuthzActor) {
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
export async function listPublishedArticles(opts: { page?: number; tag?: string } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const where = {
    status: "published" as const,
    ...(opts.tag ? { tags: { has: opts.tag.trim().toLowerCase() } } : {}),
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

  const usernames = await getUsernamesByUserIds(articles.map((a) => a.authorId));
  const withAuthor = articles.map((a) => ({
    ...a,
    author: { name: a.authorName, username: usernames.get(a.authorId) ?? null },
  }));

  return { articles: withAuthor, total, page, pageSize: PUBLIC_PAGE_SIZE };
}

/** Public article page — published only, no login. Returns null for anything else (draft/archived/unknown slug) so the route can 404 uniformly rather than leaking existence. */
export async function getPublicArticleBySlug(slug: string) {
  const article = await withRls({}, (tx) => tx.article.findFirst({ where: { slug, status: "published" } }));
  if (!article) return null;

  const usernames = await getUsernamesByUserIds([article.authorId]);
  return { ...article, author: { name: article.authorName, username: usernames.get(article.authorId) ?? null } };
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
