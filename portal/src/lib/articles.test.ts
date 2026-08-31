import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import {
  ArticleNotFoundError,
  EmailNotVerifiedError,
  RateLimitedError,
  adminUnpublishArticle,
  archiveArticle,
  createArticle,
  deriveExcerpt,
  getArticleForEdit,
  getPublicArticleBySlug,
  listMyArticles,
  publishArticle,
  renderArticleBodyHtml,
  unpublishArticle,
  updateArticle,
} from "@/lib/articles";
import { actorFromUser, cleanupTestArticles, cleanupTestUsers, createTestUser } from "@/lib/test-support";

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
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
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
