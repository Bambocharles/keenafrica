/**
 * Trustworthy client-IP resolution behind this platform's known proxy chain.
 *
 * Session 46 (Full-Platform Security & RLS Audit) — finding. Every IP-based
 * control on the platform (login brute-force per-IP limit in
 * `src/lib/auth.ts`, the anonymous-report flood limit in `src/lib/reports.ts`,
 * and the article-view dedup key in `src/lib/articles.ts`) previously keyed on
 * the *raw* `x-forwarded-for` header value, taken verbatim. That header is
 * client-controllable: Cloudflare APPENDS the real connecting IP to whatever
 * `X-Forwarded-For` the client sent, so the value the app receives is
 * `"<attacker-supplied>, <real-ip>"` — and the app was using the whole string
 * as the key. An attacker who rotates the spoofed prefix on each request gets a
 * fresh, distinct key every time, defeating every per-IP limit. This was
 * confirmed live: rotating `X-Forwarded-For` let 30/30 anonymous report
 * submissions through against a fixed limit of 8/hour/IP (a fixed IP was
 * correctly blocked after 8), and it inflated an article's public view counter
 * one spoofed IP at a time.
 *
 * The fix is to resolve the client IP the way the trusted infrastructure
 * attests it, never from the attacker-controllable part of the chain:
 *
 *  1. `CF-Connecting-IP` — Cloudflare sets this to the real connecting IP and
 *     OVERWRITES any client-supplied value (it is not passed through from the
 *     client), so it is the one header in the chain an attacker cannot forge.
 *     Production is behind Cloudflare (confirmed: `server: cloudflare`,
 *     `cf-ray` present), so this is the normal path.
 *
 *  2. Fallback: the LAST (rightmost) hop of `X-Forwarded-For` — the entry our
 *     own trusted edge appended, i.e. the least attacker-influenced part of the
 *     header — never the leftmost, which is fully client-supplied. This only
 *     matters if `CF-Connecting-IP` is somehow absent; even then it removes the
 *     spoofing bypass (an attacker prepending hops no longer changes the key),
 *     failing safe rather than open.
 *
 * Returns null when no client IP can be resolved (e.g. a direct in-cluster
 * request with no forwarding headers) — callers already treat a null IP as
 * "no per-IP limit to apply", which is the pre-existing, correct behaviour for
 * a request that genuinely has no client IP.
 */
export function resolveClientIp(h: Headers): string | null {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const xff = h.get("x-forwarded-for");
  if (!xff) return null;
  const hops = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1] : null;
}
