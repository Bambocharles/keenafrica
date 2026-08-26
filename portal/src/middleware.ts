import { NextRequest, NextResponse } from "next/server";

// Edge runtime — deliberately no DB access here. Postgres lookups happen
// later, in Server Components/Actions, which run in the Node runtime.
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "keenafrica.com";
const RESERVED_SLUGS = new Set([
  "admin",
  "teacher",
  "student",
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
     */
    "/((?!_next/static|_next/image|favicon.ico|auth).*)",
  ],
};
