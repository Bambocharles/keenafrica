import { auth } from "@/lib/auth";
import { canAccessKeenAfricanPortal } from "@/lib/authz";
import { assetDownloadResponse } from "@/lib/assets";

/**
 * Author's own authenticated preview of an in-progress (possibly still
 * draft) cover image — same shape as every other portal's
 * assets/[id]/download/route.ts. assetDownloadResponse()'s own
 * canAccessAsset() check (via canAccessAssetAttachment's 'article_cover'
 * case, src/lib/assets.ts) is what actually enforces "only this article's
 * own author, articles.manage, or super_admin" — this route only adds the
 * coarse "can reach the Keen Africans portal at all" gate every route
 * handler in this codebase performs itself (route handlers aren't wrapped
 * by their segment's layout.tsx guard).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canAccessKeenAfricanPortal(session.user)) {
    return new Response("Not authorized", { status: 403 });
  }

  const { id } = await params;
  return assetDownloadResponse(id, session.user);
}
