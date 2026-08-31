import { NextRequest, NextResponse } from "next/server";

// Edge runtime — deliberately no DB access here. Postgres lookups happen
// later, in Server Components/Actions, which run in the Node runtime.
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "keenafrica.com";
const RESERVED_SLUGS = new Set([
  "admin",
  "teacher",
  "student",
  "sponsor",
  "keenafricans",
  "www",
  "api",
  "app",
  "auth",
  "static",
  "assets",
]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const { pathname, search } = req.nextUrl;

  if (host === ROOT_DOMAIN) {
    // Bare root domain belongs to the existing static site, not this app.
    return new NextResponse("Not found", { status: 404 });
  }

  if (!host.endsWith(`.${ROOT_DOMAIN}`)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const subdomain = host.slice(0, -1 * (ROOT_DOMAIN.length + 1));

  if (subdomain === "admin") {
    const url = req.nextUrl.clone();
    url.pathname = `/admin${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Session 05 (Teacher) — mirrors the "admin" branch above. teacher.<root>
  // serves src/app/teacher/** the same way admin.<root> serves
  // src/app/admin/**.
  if (subdomain === "teacher") {
    const url = req.nextUrl.clone();
    url.pathname = `/teacher${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Session 06 (Student) — same rewrite shape as "admin"/"teacher" above.
  if (subdomain === "student") {
    const url = req.nextUrl.clone();
    url.pathname = `/student${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Session 11 (Sponsor) — same rewrite shape as "admin"/"teacher"/"student"
  // above. Deliberately its own top-level portal, not a {slug}. tenant path
  // — a sponsor org spans multiple projects (each with its own {slug}.
  // placeholder page below), so it isn't addressed by any single project's
  // subdomain.
  if (subdomain === "sponsor") {
    const url = req.nextUrl.clone();
    url.pathname = `/sponsor${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Session 34 (Keen Africans) — same rewrite shape as
  // "admin"/"teacher"/"student"/"sponsor" above. keenafricans.<root> is the
  // public, self-serve publishing section: open self-registration, no
  // approval gate, published articles readable with no login at all. A
  // reserved top-level portal, not a {slug} tenant path (mirrors "sponsor"
  // above, not the /t/[slug] project-tenant fallthrough below it).
  if (subdomain === "keenafricans") {
    const url = req.nextUrl.clone();
    url.pathname = `/keenafricans${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Reserved but not "admin"/"teacher"/"student" (e.g. someone hits
  // www.keenafrica.com) — no tenant to resolve, don't rewrite into
  // /t/[slug] with a slug that can never exist as a project.
  if (RESERVED_SLUGS.has(subdomain)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = req.nextUrl.clone();
  url.pathname = `/t/${subdomain}${pathname}`;
  url.search = search;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image, favicon.ico
     * - /auth (Auth.js routes must pass through untouched regardless of
     *   Host header, or the admin-host rewrite would mangle
     *   /auth/callback/credentials into /admin/auth/callback/credentials)
     * - /healthz (Session 16 — k8s probe target. kubelet's probe request
     *   has no *.keenafrica.com Host header, so RESERVED_SLUGS/the tenant
     *   rewrite above would 404 it before it ever reached the route.)
     */
    "/((?!_next/static|_next/image|favicon.ico|auth|healthz).*)",
  ],
};
