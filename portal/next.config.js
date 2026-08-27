/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Session 16 (Production Hardening) — defense-in-depth. The Cloudflare
  // zone this app sits behind already defines equivalent headers zone-wide
  // (../terraform/main.tf's cloudflare_zone_settings_override and the
  // "Security response headers" cloudflare_ruleset), but a live check
  // against production on 2026-08-27 found those headers absent from the
  // actual response (see status/project-status.md's Session 16 handoff) —
  // flagged there for whoever owns that shared zone config, not fixed here
  // since it's outside the portal's boundary. Setting the same policy at
  // the origin means the app is protected on its own regardless of that
  // gap, or of any future direct-to-origin access that bypasses Cloudflare.
  //
  // CSP is Report-Only, matching the Cloudflare-level policy's own
  // Report-Only choice — this repo has no violation-report collection
  // endpoint wired up yet, so promoting to enforcing without first
  // checking real traffic against it risks breaking the app for every
  // portal (admin/teacher/student/sponsor) at once. Scoped to what this
  // app actually serves (self-hosted fonts under /_next/static, no
  // external font/image CDNs), unlike the static site's policy.
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
      {
        key: "Content-Security-Policy-Report-Only",
        value:
          "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      },
    ];

    // HSTS only makes sense to assert over an actual HTTPS connection —
    // harmless to send in dev (browsers ignore it on http://localhost) but
    // scoped to production to avoid any confusion reading response headers
    // locally.
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      });
    }

    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
