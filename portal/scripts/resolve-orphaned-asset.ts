/**
 * One-time data correction (Session 45 — Outstanding Fixes & Consolidation,
 * item 5).
 *
 * Asset `10d94d8d-cd02-4488-8223-ed020e3c4eca` in production is a metadata
 * row with no real file behind it: `control-plane-bootstrap-og.png`,
 * uploaded 2026-08-31 during Session 34's cross-environment storage
 * mismatch incident (a script run with DATABASE_URL pointed at production
 * but STORAGE_DRIVER pointed at the sandbox's own local disk, so the row
 * landed in the real database while the bytes never reached R2 — see
 * docs/KEEN_AFRICANS.md's "Incident" section). Flagged by Session 34,
 * re-flagged as still open by Session 36, never mentioned again through
 * Session 44.
 *
 * Re-confirmed live on 2026-09-05 before writing this: the row still
 * exists, still `status='active'`, `storage_driver='local'`, and is
 * referenced by NOTHING — zero asset_attachments, zero resources, zero
 * project_documents, no article cover_asset_id, no profile
 * avatar_asset_id.
 *
 * WHAT THIS DOES: calls the codebase's own `deleteAssetIfOrphaned()`, i.e.
 * exactly the existing Asset lifecycle path (`purgeOrphanedAsset` —
 * status='deleted' + deleted_at, plus an `asset.deleted` AuditEvent).
 * Never a hard row DELETE: `assets` has no DELETE RLS policy at all, by
 * Session 13's design, and CLAUDE_BUILD_RULES.md §4 says to prefer
 * lifecycle states over destruction. Reversible by flipping status back.
 *
 * WHY IT CANNOT TOUCH R2: purgeOrphanedAsset() asks the configured storage
 * driver to delete the key first. This script forces STORAGE_DRIVER=local
 * before importing anything, so the delete resolves against local disk
 * (where nothing exists, and the call is `.catch(() => {})`'d anyway) and
 * can never issue a DELETE against the production bucket. That is
 * deliberate: the whole reason this row exists is a previous script running
 * with mismatched DATABASE_URL/STORAGE_DRIVER, and this one refuses to make
 * the mirror-image mistake.
 *
 * Run once:
 *   DATABASE_URL=<production> npx tsx scripts/resolve-orphaned-asset.ts
 */
process.env.STORAGE_DRIVER = "local";

import { prisma } from "../src/lib/db";
import { withRls } from "../src/lib/rls";
import { deleteAssetIfOrphaned } from "../src/lib/assets";

const ASSET_ID = "10d94d8d-cd02-4488-8223-ed020e3c4eca";

async function main() {
  const asset = await withRls({ isSuperAdmin: true }, (tx) => tx.asset.findUnique({ where: { id: ASSET_ID } }));
  if (!asset) {
    console.log(`Asset ${ASSET_ID} not found — nothing to do.`);
    return;
  }
  if (asset.status === "deleted") {
    console.log(`Asset ${ASSET_ID} is already status='deleted' (deletedAt=${asset.deletedAt?.toISOString()}) — nothing to do.`);
    return;
  }

  // Re-check every reference in this process too, not just in the
  // out-of-band SQL that preceded it — a soft-delete of an asset something
  // still points at would break that consumer's download.
  const [attachments, resources, projectDocuments, articleCovers, profileAvatars] = await withRls(
    { isSuperAdmin: true },
    (tx) =>
      Promise.all([
        tx.assetAttachment.count({ where: { assetId: ASSET_ID } }),
        tx.resource.count({ where: { assetId: ASSET_ID } }),
        tx.projectDocument.count({ where: { assetId: ASSET_ID } }),
        tx.article.count({ where: { coverAssetId: ASSET_ID } }),
        tx.profile.count({ where: { avatarAssetId: ASSET_ID } }),
      ])
  );
  const referenced = attachments + resources + projectDocuments + articleCovers + profileAvatars;
  if (referenced > 0) {
    console.error(
      `REFUSING: asset ${ASSET_ID} is still referenced ` +
        `(attachments=${attachments} resources=${resources} projectDocuments=${projectDocuments} ` +
        `articleCovers=${articleCovers} profileAvatars=${profileAvatars}). Not an orphan — investigate first.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Resolving orphaned asset ${ASSET_ID}: ${asset.originalFilename} ` +
      `(${asset.sizeBytes} bytes, driver=${asset.storageDriver}, uploaded ${asset.createdAt.toISOString()})`
  );

  // Acts as the original uploader — the real accountable actor for this
  // row, and what deleteAssetIfOrphaned()'s own uploader-or-super_admin
  // check expects. The resulting AuditEvent therefore attributes the
  // cleanup to a real person, not to an anonymous system context.
  await deleteAssetIfOrphaned(ASSET_ID, { id: asset.uploaderId, isSuperAdmin: true, permissions: [] });

  const after = await withRls({ isSuperAdmin: true }, (tx) => tx.asset.findUnique({ where: { id: ASSET_ID } }));
  console.log(`Done. status=${after?.status} deletedAt=${after?.deletedAt?.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
