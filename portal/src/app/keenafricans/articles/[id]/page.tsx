import { notFound, permanentRedirect } from "next/navigation";
import { getPublicArticleBySlug, resolveRedirectSlug } from "@/lib/articles";

/**
 * Follow-up to Session 36 (username-prefixed article URLs). This route is
 * now a permanent redirect shim, not a real page — the actual public
 * article page lives at ../../[username]/[slug]/page.tsx. Every
 * already-shared `/articles/<slug>` link (the founding article, posted to
 * LinkedIn before this change; any other article published before this
 * migration) keeps working forever via this shim rather than 404ing.
 *
 * The route segment is still named `[id]` (not `[slug]`) purely because
 * Next.js requires one consistent dynamic-segment name per URL position
 * across the whole app dir, including across route groups — this position
 * also resolves .../articles/[id]/edit under the (protected) group. The
 * value itself is still the article's slug, not its UUID id (unchanged
 * from before this follow-up).
 */
export default async function LegacyArticleRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const slug = (await params).id;

  let article = await getPublicArticleBySlug(slug);
  if (!article) {
    const currentSlug = await resolveRedirectSlug(slug);
    if (!currentSlug) notFound();
    article = await getPublicArticleBySlug(currentSlug);
    if (!article) notFound();
  }

  // Defensive: an author with no profile row yet (should not happen in
  // practice — see the new route's own comment) has no username to
  // redirect into. Fail closed to 404 rather than a broken `/null/<slug>`
  // URL — this old shim has no rendering path of its own to fall back to
  // (unlike the new route, which can still render inline in this case).
  if (!article.author.username) notFound();

  permanentRedirect(`/${article.author.username}/${article.slug}`);
}
