/**
 * One-time import (Session 34 — Keen Africans): extracts the site owner's
 * first article — originally a fully custom-styled standalone HTML file at
 * /home/keen/writing/control-plane-bootstrap.html — into the new
 * structured Article model, and publishes it through the REAL authoring
 * functions (src/lib/articles.ts's createArticle/updateArticle/
 * setCoverImage/publishArticle), under the actual registered account
 * (adebiyibanbo@gmail.com, created via the real registerUser() self-
 * registration flow — see the session handoff for the live HTTP repro).
 *
 * This does NOT hand-copy the raw HTML into a route: the body below is a
 * hand-transcribed Markdown rendering of the same real content (every
 * section, code block, table, and list), run through the same
 * renderArticleBodyHtml() (marked + sanitize-html) every other author's
 * article goes through. The original file's bespoke visual furniture (its
 * custom CSS, the inline SVG architecture diagram) is intentionally NOT
 * carried over — sessions/34-keen-africans.md explicitly allows deferring
 * that polish to Session 35 rather than blocking today's launch on it; the
 * diagram's descriptive content survives as prose/a note instead.
 *
 * Run once: npx tsx scripts/import-founding-article.ts
 * Safe to re-run: no-ops (exits early) if the article already exists.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { withRls } from "../src/lib/rls";
import type { AuthzActor } from "../src/lib/authz";
import { createArticle, publishArticle, setCoverImage, updateArticle } from "../src/lib/articles";

const AUTHOR_EMAIL = "adebiyibanbo@gmail.com";
const COVER_IMAGE_PATH = "/home/keen/writing/control-plane-bootstrap-og.png";

const TITLE = "The build agent cannot reach the database. That is the point.";

const EXCERPT =
  "Your Terraform build agent has no network route to a private-endpoint-only Azure SQL Database, and widening " +
  "the NSG is the wrong fix. How to run the work on a host that already has the route, using Azure VM Run Command " +
  "through the control plane — with the four real costs of the pattern.";

const TAGS = ["azure", "terraform", "azure-sql", "private-endpoint", "run-command", "key-vault", "iac", "devops"];

const BODY_PATH = path.join(__dirname, "founding-article-body.md");

async function resolveActor(email: string): Promise<AuthzActor> {
  const user = await withRls({ authLookup: true }, (tx) => tx.user.findUniqueOrThrow({ where: { email } }));
  const userRoles = await withRls({ userId: user.id }, (tx) =>
    tx.userRole.findMany({
      where: { userId: user.id },
      select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    })
  );
  const permissions = Array.from(
    new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)))
  );
  return { id: user.id, isSuperAdmin: user.isSuperAdmin, permissions };
}

async function main() {
  const actor = await resolveActor(AUTHOR_EMAIL);
  const BODY = await readFile(BODY_PATH, "utf-8");

  const existing = await withRls({ userId: actor.id, permissions: [...actor.permissions] }, (tx) =>
    tx.article.findFirst({ where: { authorId: actor.id, title: TITLE } })
  );

  if (existing) {
    // Repair path: an earlier run of this script produced a broken body
    // (a JS String.raw templating bug mangled the Markdown code-fence
    // backticks — see the session handoff). Re-run updateArticle() with the
    // corrected body read from the .md file above; idempotent otherwise.
    console.log(`Article already exists (id=${existing.id}, status=${existing.status}) — re-applying body/excerpt/tags via updateArticle()...`);
    await updateArticle(existing.id, { title: TITLE, body: BODY, excerpt: EXCERPT, tags: TAGS }, actor);
    if (existing.status !== "published") {
      await publishArticle(existing.id, actor);
    }
    console.log(`Updated: id=${existing.id} slug=${existing.slug}`);
    await prisma.$disconnect();
    return;
  }

  console.log("Creating draft via createArticle()...");
  const article = await createArticle({ title: TITLE, body: BODY, excerpt: EXCERPT, tags: TAGS }, actor);

  console.log("Setting excerpt/tags/body via updateArticle() (createArticle only accepts title on the real dashboard flow, this mirrors the full edit-then-save step)...");
  await updateArticle(article.id, { title: TITLE, body: BODY, excerpt: EXCERPT, tags: TAGS }, actor);

  try {
    const buffer = await readFile(COVER_IMAGE_PATH);
    console.log("Uploading cover image via setCoverImage()...");
    await setCoverImage(
      article.id,
      { originalFilename: "control-plane-bootstrap-og.png", declaredMimeType: "image/png", buffer },
      actor
    );
  } catch (err) {
    console.warn(`Cover image upload skipped: ${(err as Error).message}`);
  }

  console.log("Publishing via publishArticle()...");
  const published = await publishArticle(article.id, actor);

  console.log(`Published: id=${published.id} slug=${published.slug} status=${published.status}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
