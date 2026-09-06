import { describe, expect, it } from "vitest";
import { resolveClientIp } from "@/lib/client-ip";

/**
 * Session 46 (Full-Platform Security & RLS Audit) regression test.
 *
 * The finding: every IP-based control (login brute-force, anonymous-report
 * flood, article-view dedup) keyed on the raw `x-forwarded-for` header, which
 * Cloudflare builds as "<client-supplied>, <real-ip>" — so an attacker rotating
 * the leftmost, client-supplied hop got a fresh key on every request and
 * bypassed the limit entirely (verified live: 30/30 anonymous reports through a
 * fixed 8/hour/IP limit). These tests pin the fix: the resolved key must be
 * stable under attacker-controlled header manipulation.
 */
function headers(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

describe("resolveClientIp (Session 46 — X-Forwarded-For spoofing fix)", () => {
  it("prefers CF-Connecting-IP (the one header Cloudflare overwrites, so an attacker cannot forge it)", () => {
    // Attacker prepends spoofed hops to X-Forwarded-For; CF-Connecting-IP wins.
    const h = headers({
      "cf-connecting-ip": "198.51.100.7",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.7",
    });
    expect(resolveClientIp(h)).toBe("198.51.100.7");
  });

  it("ignores a client-supplied CF-Connecting-IP shape only insofar as we trust the edge (documented): value is used verbatim when present", () => {
    // We rely on Cloudflare to set/overwrite this; the resolver's contract is
    // simply "use it when present". Documented in client-ip.ts.
    const h = headers({ "cf-connecting-ip": "203.0.113.42" });
    expect(resolveClientIp(h)).toBe("203.0.113.42");
  });

  it("is STABLE under a rotating spoofed X-Forwarded-For prefix (the actual exploit)", () => {
    // Same real client, three different attacker-chosen prefixes: the fix must
    // resolve all three to the SAME key, or the per-IP limit is defeated.
    const real = "198.51.100.7";
    const k1 = resolveClientIp(headers({ "x-forwarded-for": `203.0.113.1, ${real}` }));
    const k2 = resolveClientIp(headers({ "x-forwarded-for": `203.0.113.2, ${real}` }));
    const k3 = resolveClientIp(headers({ "x-forwarded-for": `10.0.0.9, 172.16.0.4, ${real}` }));
    expect(k1).toBe(real);
    expect(k2).toBe(real);
    expect(k3).toBe(real);
    expect(new Set([k1, k2, k3]).size).toBe(1);
  });

  it("never returns the leftmost, fully client-controlled hop", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.66, 198.51.100.7" });
    expect(resolveClientIp(h)).not.toBe("203.0.113.66");
  });

  it("falls back to the last XFF hop when CF-Connecting-IP is absent", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(resolveClientIp(headers({ "x-forwarded-for": " 198.51.100.7 " }))).toBe("198.51.100.7");
  });

  it("returns null when no client IP can be resolved (no per-IP limit to apply)", () => {
    expect(resolveClientIp(headers({}))).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": "" }))).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": " , " }))).toBeNull();
  });
});
