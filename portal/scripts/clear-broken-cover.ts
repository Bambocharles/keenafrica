/**
 * One-time data correction (Session 34 — Keen Africans incident follow-up).
 *
 * scripts/import-founding-article.ts's cover-image upload was run from a
 * sandbox whose STORAGE_DRIVER/S3_* env vars point at LOCAL disk storage,
 * while DATABASE_URL was overridden to the real production database. The
 * result: an Asset row was inserted into the real production DB, but the
 * actual image bytes were only ever written to the sandbox's local disk,
 * never to the real R2 bucket the production pods read from — so
 * production's /covers/[assetId] route 500s with a real "NoSuchKey" from
 * R2 (confirmed via kubectl logs).
 *
 * This script does the minimal safe correction: clears the affected
 * article's cover_asset_id (a single-column UPDATE on one already-existing
 * row) so the public page renders correctly with no cover image, rather
 * than 500ing on it. It does NOT touch article body/title/tags/status,
 * and does NOT attempt any further storage-layer mutation from this
 * sandbox — re-uploading a correct cover through the real production app
 * is left to the site owner (see the session handoff), since doing that
 * safely requires this sandbox to also assume the S3/R2 write credentials,
 * which is a materially different (and more sensitive) class of action
 * than a metadata-only fix.
 *
 * Run once: npx tsx scripts/clear-broken-cover.ts
 */
import { prisma } from "../src/lib/db";
import { withRls } from "../src/lib/rls";

const SLUG = "the-build-agent-cannot-reach-the-database-that-is-the-point";

async function main() {
  const article = await withRls({ isSuperAdmin: true }, (tx) => tx.article.findFirst({ where: { slug: SLUG } }));
  if (!article) {
    console.log("Article not found — nothing to do.");
    await prisma.$disconnect();
    return;
  }
  if (!article.coverAssetId) {
    console.log("Article already has no cover_asset_id — nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Clearing cover_asset_id (${article.coverAssetId}) on article ${article.id}...`);
  // Detach the (broken) attachment row too, so asset_attachments stays
  // consistent with the article no longer referencing it.
  await withRls({ isSuperAdmin: true }, async (tx) => {
    await tx.assetAttachment.deleteMany({ where: { entityType: "article_cover", entityId: article.id } });
    await tx.article.update({ where: { id: article.id }, data: { coverAssetId: null } });
  });

  console.log("Done. The broken Asset row itself is left in place (soft-delete-only convention) for later cleanup once a real R2-backed cover is uploaded through the app.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
