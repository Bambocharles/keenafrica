import { getPublicAvatarBytes } from "@/lib/profiles";

/**
 * Public, unauthenticated avatar bytes — mirrors
 * src/app/keenafricans/covers/[assetId]/route.ts exactly, one entity type
 * over. See src/lib/profiles.ts's getPublicAvatarBytes() for why this is
 * safe (no login, no portal-shell gate: a profile has no draft state, so
 * an avatar is always public once attached).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const result = await getPublicAvatarBytes(assetId);
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
