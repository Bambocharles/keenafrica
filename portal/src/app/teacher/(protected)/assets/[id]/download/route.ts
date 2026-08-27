import { auth } from "@/lib/auth";
import { canAccessTeacherPortal } from "@/lib/authz";
import { assetDownloadResponse } from "@/lib/assets";

/** See src/app/student/(protected)/assets/[id]/download/route.ts's header comment. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !canAccessTeacherPortal(session.user)) {
    return new Response("Not authorized", { status: 403 });
  }

  const { id } = await params;
  return assetDownloadResponse(id, session.user);
}
