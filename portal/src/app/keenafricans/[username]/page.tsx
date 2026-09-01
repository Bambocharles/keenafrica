import { permanentRedirect } from "next/navigation";

/**
 * Follow-up to Session 36. A bare `/<username>` (no article slug) is what
 * a visitor would reasonably expect from truncating an article URL — send
 * them to the real profile page rather than 404ing. Does not verify the
 * username actually exists first (cheap, matches this codebase's existing
 * convention elsewhere of redirecting rather than pre-checking — see e.g.
 * the old /articles/[id] redirect shim, which also redirects on a slug
 * match without a separate existence check beforehand); `/u/[username]`
 * itself already 404s cleanly for an unknown username.
 */
export default async function BareUsernamePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  permanentRedirect(`/u/${username}`);
}
