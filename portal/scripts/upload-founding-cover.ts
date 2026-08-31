/**
 * One-time follow-up (Session 34 — Keen Africans): uploads the real cover
 * image for the founding article through the actual setCoverImage()
 * function, run with the FULL production storage config (STORAGE_DRIVER=
 * s3 + S3_* vars, in addition to DATABASE_URL) — unlike the earlier
 * import script's cover-upload attempt, which only had DATABASE_URL
 * overridden and so wrote bytes to local disk instead of the real R2
 * bucket (see docs/KEEN_AFRICANS.md's "Incident" section for that
 * writeup; scripts/clear-broken-cover.ts cleared the resulting broken
 * reference).
 *
 * Run once, with DATABASE_URL/STORAGE_DRIVER/S3_* all set to production
 * values: npx tsx scripts/upload-founding-cover.ts
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { withRls } from "../src/lib/rls";
import { setCoverImage } from "../src/lib/articles";
import type { AuthzActor } from "../src/lib/authz";

const SLUG = "the-build-agent-cannot-reach-the-database-that-is-the-point";
const COVER_IMAGE_PATH = "/home/keen/writing/control-plane-bootstrap-og.png";
const AUTHOR_EMAIL = "adebiyibanbo@gmail.com";

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
  if ((process.env.STORAGE_DRIVER ?? "local") !== "s3") {
    throw new Error(
      `Refusing to run: STORAGE_DRIVER is "${process.env.STORAGE_DRIVER ?? "local"}", not "s3" — this is exactly ` +
        "the cross-environment mistake this script exists to avoid. Set STORAGE_DRIVER=s3 and the real S3_* vars."
    );
  }

  const actor = await resolveActor(AUTHOR_EMAIL);
  const article = await withRls({ userId: actor.id, permissions: [...actor.permissions] }, (tx) =>
    tx.article.findFirstOrThrow({ where: { slug: SLUG } })
  );

  const buffer = await readFile(COVER_IMAGE_PATH);
  console.log(`Uploading real cover image (${buffer.length} bytes) via setCoverImage(), storage driver=s3...`);
  const asset = await setCoverImage(
    article.id,
    { originalFilename: "control-plane-bootstrap-og.png", declaredMimeType: "image/png", buffer },
    actor
  );

  console.log(`Done. New coverAssetId=${asset.id}, storageDriver=${asset.storageDriver}, storageKey=${asset.storageKey}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
