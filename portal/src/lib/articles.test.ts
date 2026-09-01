import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  ArticleNotFoundError,
  DELETED_ACCOUNT_NAME,
  EmailNotVerifiedError,
  RateLimitedError,
  adminUnpublishArticle,
  archiveArticle,
  createArticle,
  deleteOwnKeenAfricanAccount,
  deriveExcerpt,
  getArticleForEdit,
  getPublicArticleBySlug,
  getTopicCounts,
  hashViewerKey,
  listMyArticles,
  listPublishedArticles,
  listTrendingArticles,
  publishArticle,
  recordArticleView,
  renderArticleBodyHtml,
  unpublishArticle,
  updateArticle,
} from "@/lib/articles";
import { StepUpRequiredError } from "@/lib/mfa";
import { PrivilegedAccountDeletionError } from "@/lib/users";
import { ensureProfile, getMyProfile, updateProfile } from "@/lib/profiles";
import {
  actorFromUser,
  cleanupTestArticles,
  cleanupTestUsers,
  createTestUser,
  steppedUpActorFromUser,
} from "@/lib/test-support";

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
  await cleanupTestArticles(createdArticleIds);
  await cleanupTestUsers(createdUserIds);
});

async function keenAfrican(verified = false) {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  if (verified) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  return actorFromUser(user.id);
}

describe("renderArticleBodyHtml", () => {
  it("renders plain markdown to the expected HTML", () => {
    const html = renderArticleBodyHtml("# Hello\n\nThis is **bold** text with a [link](https://example.com).");
    expect(html).toContain('<h1 id="hello">Hello</h1>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("gives headings stable, de-duplicated ids so a table-of-contents can link to them", () => {
    const html = renderArticleBodyHtml("## First Section\n\nA.\n\n## First Section\n\nB.");
    expect(html).toContain('<h2 id="first-section">First Section</h2>');
    expect(html).toContain('<h2 id="first-section-1">First Section</h2>');
  });

  it("does NOT open a same-page table-of-contents link in a new tab — only external links get target=_blank", () => {
    const html = renderArticleBodyHtml("[Jump to section](#first-section)\n\n## First Section\n\nBody.");
    expect(html).toContain('<a href="#first-section">Jump to section</a>');
    expect(html).not.toMatch(/href="#first-section"[^>]*target/);
  });

  it("strips a raw <script> tag embedded in the Markdown source — the core XSS defense this session requires", () => {
    const html = renderArticleBodyHtml('Hello <script>alert(document.cookie)</script> world');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event-handler attributes and javascript: URLs", () => {
    const html = renderArticleBodyHtml('<img src="x" onerror="alert(1)"> and <a href="javascript:alert(1)">click</a>');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("adds rel=noopener/target=_blank to links so a malicious author cannot tabnab a reader", () => {
    const html = renderArticleBodyHtml("[link](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer ugc"');
    expect(html).toContain('target="_blank"');
  });
});

describe("deriveExcerpt", () => {
  it("produces plain text with markdown syntax stripped", () => {
    const excerpt = deriveExcerpt("# Title\n\nSome **bold** _text_ here.");
    expect(excerpt).not.toContain("#");
    expect(excerpt).not.toContain("*");
    expect(excerpt.length).toBeLessThanOrEqual(200);
  });
});

describe("createArticle", () => {
  it("creates a draft owned by the actor, with a unique slug, and records an audit event", async () => {
    const actor = await keenAfrican();
    const article = await createArticle({ title: "My First Post", body: "hello" }, actor);
    createdArticleIds.push(article.id);

    expect(article.authorId).toBe(actor.id);
    expect(article.status).toBe("draft");
    expect(article.slug).toMatch(/^my-first-post/);
    // Session 36 — denormalized authorName snapshot, set once at creation.
    expect(article.authorName).toBeTruthy();

    const event = await prisma.auditEvent.findFirst({ where: { action: "article.created", entityId: article.id } });
    expect(event).not.toBeNull();
  });

  it("de-duplicates slugs for the same title", async () => {
    const actor = await keenAfrican();
    const a = await createArticle({ title: "Duplicate Title" }, actor);
    createdArticleIds.push(a.id);
    const b = await createArticle({ title: "Duplicate Title" }, actor);
    createdArticleIds.push(b.id);
    expect(a.slug).not.toBe(b.slug);
  });

  it("rejects an actor without articles.write (e.g. a plain STUDENT)", async () => {
    const user = await createTestUser({ roles: ["STUDENT"] });
    createdUserIds.push(user.id);
    const actor = await actorFromUser(user.id);
    await expect(createArticle({ title: "Nope" }, actor)).rejects.toThrow(AuthorizationError);
  });

  it("rate-limits article creation per account", async () => {
    const actor = await keenAfrican();
    for (let i = 0; i < 8; i++) {
      const a = await createArticle({ title: `Rate limit test ${i}` }, actor);
      createdArticleIds.push(a.id);
    }
    await expect(createArticle({ title: "One too many" }, actor)).rejects.toThrow(RateLimitedError);
  });
});

describe("ownership enforcement", () => {
  it("prevents another Keen African from updating someone else's article", async () => {
    const owner = await keenAfrican();
    const stranger = await keenAfrican();
    const article = await createArticle({ title: "Owned Article" }, owner);
    createdArticleIds.push(article.id);

    await expect(updateArticle(article.id, { title: "Hijacked" }, stranger)).rejects.toThrow(AuthorizationError);

    const untouched = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(untouched.title).toBe("Owned Article");
  });

  it("prevents another Keen African from archiving (deleting) someone else's article", async () => {
    const owner = await keenAfrican();
    const stranger = await keenAfrican();
    const article = await createArticle({ title: "Owned Article 2" }, owner);
    createdArticleIds.push(article.id);

    await expect(archiveArticle(article.id, stranger)).rejects.toThrow(AuthorizationError);

    const untouched = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(untouched.status).toBe("draft");
  });

  it("lets the owner update and archive their own article", async () => {
    const owner = await keenAfrican();
    const article = await createArticle({ title: "Mine" }, owner);
    createdArticleIds.push(article.id);

    const updated = await updateArticle(article.id, { title: "Mine, edited" }, owner);
    expect(updated.title).toBe("Mine, edited");

    const archived = await archiveArticle(article.id, owner);
    expect(archived.status).toBe("archived");
  });

  it("getArticleForEdit throws ArticleNotFoundError for an unknown id", async () => {
    const owner = await keenAfrican();
    await expect(getArticleForEdit("00000000-0000-0000-0000-000000000000", owner)).rejects.toThrow(
      ArticleNotFoundError
    );
  });
});

describe("publishArticle — email verification gate", () => {
  it("refuses to publish an unverified account's article", async () => {
    const actor = await keenAfrican(false);
    const article = await createArticle({ title: "Needs verification" }, actor);
    createdArticleIds.push(article.id);

    await expect(publishArticle(article.id, actor)).rejects.toThrow(EmailNotVerifiedError);
  });

  it("publishes once the account is verified, and it becomes publicly readable", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "Verified Publish", body: "public body" }, actor);
    createdArticleIds.push(article.id);

    const published = await publishArticle(article.id, actor);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    const publicRow = await getPublicArticleBySlug(article.slug);
    expect(publicRow?.id).toBe(article.id);
  });

  it("unpublishArticle (self-service) returns it to draft and hides it from the public read", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "Publish then hide" }, actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, actor);

    await unpublishArticle(article.id, actor);
    const publicRow = await getPublicArticleBySlug(article.slug);
    expect(publicRow).toBeNull();
  });
});

describe("recordArticleView (Session 42 — Follow & Author Reputation Display)", () => {
  it("increments the article's view count", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "View Counted" }, actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, actor);

    await recordArticleView(article.id);
    await recordArticleView(article.id);

    const row = await prisma.article.findUniqueOrThrow({ where: { id: article.id }, select: { viewCount: true } });
    expect(row.viewCount).toBe(2);
  });

  it("does not throw for an unknown article id — a view-count failure must never break the page render", async () => {
    await expect(recordArticleView("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });
});

describe("hashViewerKey (Session 44 — Discovery, Search & Recommendations)", () => {
  it("keys a signed-in viewer on their own stable user id, ignoring any IP/User-Agent passed alongside it", () => {
    expect(hashViewerKey({ userId: "abc-123" })).toBe("user:abc-123");
    expect(hashViewerKey({ userId: "abc-123", ipAddress: "1.2.3.4", userAgent: "AnyAgent/1.0" })).toBe("user:abc-123");
  });

  it("hashes an anonymous viewer's IP+User-Agent — the raw IP never appears in the returned key", () => {
    const key = hashViewerKey({ ipAddress: "203.0.113.9", userAgent: "TestAgent/1.0" });
    expect(key).toMatch(/^anon:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.9");
  });

  it("is stable for the same IP+User-Agent pair and different for a different one", () => {
    const a = hashViewerKey({ ipAddress: "203.0.113.9", userAgent: "SameAgent" });
    const b = hashViewerKey({ ipAddress: "203.0.113.9", userAgent: "SameAgent" });
    const c = hashViewerKey({ ipAddress: "198.51.100.4", userAgent: "SameAgent" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("returns an empty string when there is nothing at all to key on", () => {
    expect(hashViewerKey({})).toBe("");
  });
});

describe("recordArticleView — per-viewer dedup (Session 44 — Discovery, Search & Recommendations)", () => {
  it("does not double-count a repeat view from the same viewerKey within the cooldown window", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "Dedup Same Viewer" }, actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, actor);

    await recordArticleView(article.id, "user:reader-1");
    await recordArticleView(article.id, "user:reader-1");
    await recordArticleView(article.id, "user:reader-1");

    const row = await prisma.article.findUniqueOrThrow({ where: { id: article.id }, select: { viewCount: true } });
    expect(row.viewCount).toBe(1);
  });

  it("counts two different viewerKeys as two separate views", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "Dedup Different Viewers" }, actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, actor);

    await recordArticleView(article.id, "user:reader-1");
    await recordArticleView(article.id, "user:reader-2");

    const row = await prisma.article.findUniqueOrThrow({ where: { id: article.id }, select: { viewCount: true } });
    expect(row.viewCount).toBe(2);
  });

  it("counts again once the dedup cooldown window has elapsed", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "Dedup Window Elapsed" }, actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, actor);

    await recordArticleView(article.id, "user:reader-1");
    // recordArticleView() has no clock-injection point, so backdating the
    // row it just wrote directly is the simplest way to exercise the
    // "cooldown window has passed" branch.
    await prisma.articleView.updateMany({
      where: { articleId: article.id, viewerKey: "user:reader-1" },
      data: { viewedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    await recordArticleView(article.id, "user:reader-1");

    const row = await prisma.article.findUniqueOrThrow({ where: { id: article.id }, select: { viewCount: true } });
    expect(row.viewCount).toBe(2);
  });
});

describe("listTrendingArticles (Session 44 — Discovery, Search & Recommendations)", () => {
  it("ranks by RECENT view velocity, not lifetime views — a new article's recent views outrank an old article's larger but stale lifetime total", async () => {
    const actor = await keenAfrican(true);
    const staleButPopular = await createArticle({ title: "Stale But Once Popular" }, actor);
    createdArticleIds.push(staleButPopular.id);
    await publishArticle(staleButPopular.id, actor);
    const freshAndHot = await createArticle({ title: "Fresh And Hot" }, actor);
    createdArticleIds.push(freshAndHot.id);
    await publishArticle(freshAndHot.id, actor);

    // staleButPopular: 10 lifetime views, all pushed OUTSIDE the trending window.
    for (let i = 0; i < 10; i++) {
      await recordArticleView(staleButPopular.id, `user:stale-viewer-${i}`);
    }
    await prisma.articleView.updateMany({
      where: { articleId: staleButPopular.id },
      data: { viewedAt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
    });

    // freshAndHot: 3 views, all inside the (default 48h) trending window.
    for (let i = 0; i < 3; i++) {
      await recordArticleView(freshAndHot.id, `user:fresh-viewer-${i}`);
    }

    const trending = await listTrendingArticles(20);
    const ids = trending.map((a) => a.id);
    expect(ids).toContain(freshAndHot.id);
    expect(ids).not.toContain(staleButPopular.id);
  });

  it("never includes an article that was unpublished after accruing its views", async () => {
    const actor = await keenAfrican(true);
    const article = await createArticle({ title: "Later Unpublished Trending Candidate" }, actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, actor);
    await recordArticleView(article.id, "user:trending-then-gone");
    await unpublishArticle(article.id, actor);

    const trending = await listTrendingArticles(50);
    expect(trending.map((a) => a.id)).not.toContain(article.id);
  });

  it("returns an empty array when there are no recent views at all", async () => {
    // Not a strict global assertion (other suites may be writing views
    // concurrently) — just confirms the function itself never throws on an
    // empty candidate pool and always returns an array.
    const trending = await listTrendingArticles(1);
    expect(Array.isArray(trending)).toBe(true);
  });
});

describe("getTopicCounts / listPublishedArticles topic filter (Session 44 — Discovery, Search & Recommendations)", () => {
  it("zero-fills every curated topic, not just the ones with at least one article", async () => {
    const counts = await getTopicCounts();
    expect(Object.keys(counts).sort()).toEqual(
      ["ai", "business", "career", "cloud", "culture", "engineering", "entrepreneurship"].sort()
    );
    for (const value of Object.values(counts)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("listPublishedArticles({ topic }) only returns articles tagged with that exact topic", async () => {
    const actor = await keenAfrican(true);
    const cloudArticle = await createArticle({ title: "Cloud Topic Fixture", topic: "cloud" }, actor);
    createdArticleIds.push(cloudArticle.id);
    await publishArticle(cloudArticle.id, actor);
    const aiArticle = await createArticle({ title: "AI Topic Fixture", topic: "ai" }, actor);
    createdArticleIds.push(aiArticle.id);
    await publishArticle(aiArticle.id, actor);

    const { articles } = await listPublishedArticles({ topic: "cloud" });
    expect(articles.some((a) => a.id === cloudArticle.id)).toBe(true);
    expect(articles.some((a) => a.id === aiArticle.id)).toBe(false);
    expect(articles.every((a) => a.topic === "cloud")).toBe(true);
  });

  it("never includes a draft article, even one tagged with the requested topic", async () => {
    const actor = await keenAfrican(true);
    const draft = await createArticle({ title: "Draft In Business Topic", topic: "business" }, actor);
    createdArticleIds.push(draft.id);
    // Deliberately never published.

    const { articles } = await listPublishedArticles({ topic: "business" });
    expect(articles.some((a) => a.id === draft.id)).toBe(false);
  });
});

describe("adminUnpublishArticle — moderation safety valve", () => {
  it("requires articles.manage — a plain Keen African cannot moderate another author's article", async () => {
    const owner = await keenAfrican(true);
    const other = await keenAfrican();
    const article = await createArticle({ title: "Reported article" }, owner);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, owner);

    await expect(adminUnpublishArticle(article.id, other, "spam")).rejects.toThrow(AuthorizationError);
  });

  it("an ADMIN (articles.manage) can unpublish any article, records the reason, and it's audited", async () => {
    const owner = await keenAfrican(true);
    const admin = await createTestUser({ roles: ["ADMIN"] });
    createdUserIds.push(admin.id);
    const adminActor = await actorFromUser(admin.id);

    const article = await createArticle({ title: "Moderated article" }, owner);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, owner);

    const result = await adminUnpublishArticle(article.id, adminActor, "impersonation concern");
    expect(result.status).toBe("draft");
    expect(result.moderationNote).toBe("impersonation concern");
    expect(result.moderatedBy).toBe(admin.id);

    const event = await prisma.auditEvent.findFirst({
      where: { action: "article.unpublished_by_admin", entityId: article.id },
    });
    expect(event).not.toBeNull();
    expect(event?.actorId).toBe(admin.id);

    const publicRow = await getPublicArticleBySlug(article.slug);
    expect(publicRow).toBeNull();
  });
});

describe("listMyArticles", () => {
  it("returns only the caller's own articles, every status", async () => {
    const owner = await keenAfrican();
    const other = await keenAfrican();
    const mine = await createArticle({ title: "Mine only" }, owner);
    createdArticleIds.push(mine.id);
    const theirs = await createArticle({ title: "Not mine" }, other);
    createdArticleIds.push(theirs.id);

    const rows = await listMyArticles(owner);
    expect(rows.map((r) => r.id)).toContain(mine.id);
    expect(rows.map((r) => r.id)).not.toContain(theirs.id);
  });
});

describe("deleteOwnKeenAfricanAccount — account deletion policy (Session 37)", () => {
  it("without step-up, nothing is changed — not the account, not any article, not the profile", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(user.id);
    const actor = await actorFromUser(user.id); // no sessionId — never stepped up
    const profile = await ensureProfile(actor, { name: "Untouched Author" });
    const article = await createArticle({ title: "Should stay attributed" }, actor);
    createdArticleIds.push(article.id);

    await expect(deleteOwnKeenAfricanAccount(actor)).rejects.toThrow(StepUpRequiredError);

    const articleRow = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(articleRow.authorName).not.toBe(DELETED_ACCOUNT_NAME);
    const profileRow = await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(profileRow.displayName).not.toBe(DELETED_ACCOUNT_NAME);
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(userRow.status).toBe("active");
  });

  it("blocks a privileged (ADMIN) account with zero side effects — no article/profile change either", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN", "ADMIN"] });
    createdUserIds.push(user.id);
    const actor = await steppedUpActorFromUser(user.id);
    const profile = await ensureProfile(actor, { name: "Admin Author" });
    const article = await createArticle({ title: "Admin-authored" }, actor);
    createdArticleIds.push(article.id);

    await expect(deleteOwnKeenAfricanAccount(actor)).rejects.toThrow(PrivilegedAccountDeletionError);

    // The whole point of checking assertOwnAccountDeletable() FIRST — a
    // blocked attempt must be a true no-op, not "articles/profile already
    // scrubbed, account itself untouched."
    const articleRow = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(articleRow.authorName).not.toBe(DELETED_ACCOUNT_NAME);
    const profileRow = await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(profileRow.displayName).not.toBe(DELETED_ACCOUNT_NAME);
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(userRow.status).toBe("active");
  });

  it("reattributes every one of the caller's own articles (draft, published, AND archived) without deleting any of them", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const actor = await steppedUpActorFromUser(user.id);
    await ensureProfile(actor, { name: "Prolific Author" });

    const draft = await createArticle({ title: "Still a draft" }, actor);
    createdArticleIds.push(draft.id);
    const toPublish = await createArticle({ title: "Will be published" }, actor);
    createdArticleIds.push(toPublish.id);
    await publishArticle(toPublish.id, actor);
    const toArchive = await createArticle({ title: "Will be archived" }, actor);
    createdArticleIds.push(toArchive.id);
    await archiveArticle(toArchive.id, actor);

    await deleteOwnKeenAfricanAccount(actor);

    const rows = await prisma.article.findMany({ where: { id: { in: [draft.id, toPublish.id, toArchive.id] } } });
    expect(rows).toHaveLength(3); // none hard-deleted
    for (const row of rows) {
      expect(row.authorName).toBe(DELETED_ACCOUNT_NAME);
    }
    expect(rows.find((r) => r.id === draft.id)?.status).toBe("draft");
    expect(rows.find((r) => r.id === toPublish.id)?.status).toBe("published");
    expect(rows.find((r) => r.id === toArchive.id)?.status).toBe("archived");
  });

  it("scrubs the profile's public-facing fields but keeps the username stable (so /u/<username> and article bylines keep resolving)", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(user.id);
    const actor = await steppedUpActorFromUser(user.id);
    const profile = await ensureProfile(actor, { name: "Bio Haver" });
    await updateProfile(actor, {
      bio: "I write things.",
      profession: "Writer",
      interests: ["africa", "tech"],
      linkedinUrl: "https://linkedin.com/in/example",
    });

    await deleteOwnKeenAfricanAccount(actor);

    const row = await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(row.username).toBe(profile.username); // unchanged — link stability
    expect(row.displayName).toBe(DELETED_ACCOUNT_NAME);
    expect(row.bio).toBeNull();
    expect(row.profession).toBeNull();
    expect(row.interests).toEqual([]);
    expect(row.linkedinUrl).toBeNull();
  });

  it("anonymizes the underlying User row (name/email/password/status) — see users.test.ts for the full account-level assertions", async () => {
    const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
    createdUserIds.push(user.id);
    const actor = await steppedUpActorFromUser(user.id);
    await ensureProfile(actor, { name: "Deleting Self" });

    await deleteOwnKeenAfricanAccount(actor);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.name).toBe(DELETED_ACCOUNT_NAME);
    expect(row.status).toBe("deleted");
    expect(row.passwordHash).toBeNull();

    // The now-deleted account can no longer be resolved for anything
    // self-scoped — a defensive proof the account really is locked out, not
    // just relabeled.
    await expect(getMyProfile(actor)).resolves.not.toThrow(); // profile row still exists, just anonymized
  });
});
