import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createArticle, publishArticle, unpublishArticle } from "@/lib/articles";
import { ensureProfile, updateProfile } from "@/lib/profiles";
import { searchArticles, searchAuthors } from "@/lib/search";
import { actorFromUser, cleanupTestArticles, cleanupTestProfiles, cleanupTestUsers, createTestUser } from "@/lib/test-support";

/**
 * Discovery, Search & Recommendations (Session 44). Covers
 * searchArticles()/searchAuthors() — this session's own explicit
 * acceptance criteria: search returns relevant results across articles
 * (title/body/tags) and authors (name/username/profession), and NEVER
 * leaks a draft article. Each query uses a random unique token so results
 * are unambiguous even though this test file shares a DB with every other
 * suite running concurrently.
 */

const createdUserIds: string[] = [];
const createdArticleIds: string[] = [];

afterAll(async () => {
  await cleanupTestArticles(createdArticleIds);
  await cleanupTestProfiles(createdUserIds);
  await cleanupTestUsers(createdUserIds);
});

async function keenAfrican(name = "Keen African") {
  const user = await createTestUser({ roles: ["KEEN_AFRICAN"] });
  createdUserIds.push(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  const actor = await actorFromUser(user.id);
  const profile = await ensureProfile(actor, { name });
  return { user, actor, profile };
}

describe("searchArticles", () => {
  it("finds a published article by a word in its title", async () => {
    const author = await keenAfrican();
    const token = randomUUID().replace(/-/g, "");
    const article = await createArticle(
      { title: `Zanzibar${token} Cloud Infrastructure Guide`, body: "A deep dive into deployment." },
      author.actor
    );
    createdArticleIds.push(article.id);
    await publishArticle(article.id, author.actor);

    const results = await searchArticles(`Zanzibar${token}`);
    expect(results.some((r) => r.id === article.id)).toBe(true);
  });

  it("finds a published article by a word in its body", async () => {
    const author = await keenAfrican();
    const token = randomUUID().replace(/-/g, "");
    const article = await createArticle(
      { title: "Body Search Fixture", body: `This article explores fintechinnovation${token} at length.` },
      author.actor
    );
    createdArticleIds.push(article.id);
    await publishArticle(article.id, author.actor);

    const results = await searchArticles(`fintechinnovation${token}`);
    expect(results.some((r) => r.id === article.id)).toBe(true);
  });

  it("finds a published article by an exact tag", async () => {
    const author = await keenAfrican();
    // Kept short (unlike the other fixtures' full-length token): tags are
    // normalize-truncated to 40 chars (see articles.ts's normalizeTags()),
    // and the exact-match tag lookup below needs the full, untruncated
    // string to round-trip.
    const token = randomUUID().replace(/-/g, "").toLowerCase().slice(0, 10);
    const article = await createArticle(
      { title: "Tag Search Fixture", body: "Body.", tags: [`renewableenergy${token}`] },
      author.actor
    );
    createdArticleIds.push(article.id);
    await publishArticle(article.id, author.actor);

    const results = await searchArticles(`renewableenergy${token}`);
    expect(results.some((r) => r.id === article.id)).toBe(true);
  });

  it("NEVER returns a draft article, even one whose title exactly matches the query", async () => {
    const author = await keenAfrican();
    const token = randomUUID().replace(/-/g, "");
    const draft = await createArticle(
      { title: `UnpublishedSecret${token} Draft`, body: "Should never be found by search." },
      author.actor
    );
    createdArticleIds.push(draft.id);
    // Deliberately never published.

    const results = await searchArticles(`UnpublishedSecret${token}`);
    expect(results.some((r) => r.id === draft.id)).toBe(false);
  });

  it("stops returning an article once it's unpublished again", async () => {
    const author = await keenAfrican();
    const token = randomUUID().replace(/-/g, "");
    const article = await createArticle({ title: `Ephemeral${token} Article`, body: "Body." }, author.actor);
    createdArticleIds.push(article.id);
    await publishArticle(article.id, author.actor);
    expect((await searchArticles(`Ephemeral${token}`)).some((r) => r.id === article.id)).toBe(true);

    await unpublishArticle(article.id, author.actor);
    expect((await searchArticles(`Ephemeral${token}`)).some((r) => r.id === article.id)).toBe(false);
  });

  it("returns an empty array for a blank query rather than every article", async () => {
    expect(await searchArticles("")).toEqual([]);
    expect(await searchArticles("   ")).toEqual([]);
  });
});

describe("searchAuthors", () => {
  it("finds an author by display name", async () => {
    const token = randomUUID().replace(/-/g, "");
    const author = await keenAfrican(`Kwame Nkrumah${token}`);

    const results = await searchAuthors(`Nkrumah${token}`);
    expect(results.some((r) => r.userId === author.user.id)).toBe(true);
  });

  it("finds an author by username", async () => {
    const token = randomUUID().replace(/-/g, "").toLowerCase().slice(0, 12);
    const author = await keenAfrican("Username Search Fixture");
    await updateProfile(author.actor, { username: `uniqueuser${token}` });

    const results = await searchAuthors(`uniqueuser${token}`);
    expect(results.some((r) => r.userId === author.user.id)).toBe(true);
  });

  it("finds an author by profession", async () => {
    const token = randomUUID().replace(/-/g, "");
    const author = await keenAfrican("Profession Search Fixture");
    await updateProfile(author.actor, { profession: `Quantum Cryptographer ${token}` });

    const results = await searchAuthors(`Cryptographer ${token}`);
    expect(results.some((r) => r.userId === author.user.id)).toBe(true);
  });

  it("returns an empty array for a blank query", async () => {
    expect(await searchAuthors("")).toEqual([]);
  });
});
