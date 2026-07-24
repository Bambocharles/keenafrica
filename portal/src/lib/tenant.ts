import { withRls } from "@/lib/rls";
import { auth } from "@/lib/auth";

/**
 * Looks up an active project by slug for the public tenant page. Runs
 * unauthenticated (no session), so RLS's projects_select policy only
 * returns it if status = 'active' unless the caller happens to be a
 * logged-in super-admin previewing a draft/paused project.
 */
export async function getProjectBySlug(slug: string) {
  const session = await auth();
  return withRls(
    { userId: session?.user?.id, isSuperAdmin: session?.user?.isSuperAdmin },
    (tx) =>
      tx.project.findUnique({
        where: { slug },
        include: { sponsor: true },
      })
  );
}
