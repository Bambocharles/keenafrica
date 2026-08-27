import { auth } from "@/lib/auth";
import { canAccessStudentPortal } from "@/lib/authz";
import { assetDownloadResponse } from "@/lib/assets";

/**
 * Session 13 (Files & Content Assets). Route handlers are NOT wrapped by
 * `(protected)/layout.tsx` (App Router layouts only wrap rendered pages),
 * so the portal-shell gate is re-checked here explicitly — the actual
 * per-asset authorization (ownership/attachment visibility) lives in
 * src/lib/assets.ts, shared with the teacher/admin download routes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canAccessStudentPortal(session.user)) {
    return new Response("Not authorized", { status: 403 });
  }

  const { id } = await params;
  return assetDownloadResponse(id, session.user);
}
