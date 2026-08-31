import { getPublicArticleCoverBytes } from "@/lib/articles";

/**
 * Public, unauthenticated cover-image bytes for a PUBLISHED article's cover
 * only — see src/lib/articles.ts's getPublicArticleCoverBytes() for why
 * this is safe (the RLS policy backing it already restricts an anonymous
 * read to exactly this case). No login, no portal-shell gate — this is
 * the one asset route in the codebase deliberately open to the public,
 * because the public article page (src/app/keenafricans/articles/[slug])
 * itself is.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const result = await getPublicArticleCoverBytes(assetId);
  if (!result) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.buffer.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}
