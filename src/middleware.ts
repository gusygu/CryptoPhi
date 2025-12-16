import { NextResponse, type NextRequest } from "next/server";
import { resolveBadgeScope } from "@/lib/server/badge-scope";

const PAGE_GLOBAL_ROOTS = new Set(["auth", "docs", "info"]);
const PAGE_FEATURE_ROOTS = new Set([
  "dashboard",
  "matrices",
  "dynamics",
  "cin-aux",
  "str-aux",
  "invites",
  "mgmt",
  "settings",
  "audit",
  "snapshot",
  "profile",
  "trade",
  "admin",
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API traffic should pass through without rewrites to avoid double-prefix bugs.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const segments = pathname.split("/").filter(Boolean);
  const scope = resolveBadgeScope(req, { badge: segments[0] ?? null });

  // ---- Non-API: redirect to badge-scoped path (except auth/docs/info/static)
  const first = segments[0] ?? "";
  const isStatic =
    first.startsWith("_next") ||
    first === "favicon.ico" ||
    first === "robots.txt" ||
    first === "sitemap.xml" ||
    first === "assets";

  if (!isStatic && !PAGE_GLOBAL_ROOTS.has(first)) {
    const badge = scope.effectiveBadge || scope.badgeCookie || "global";

    // Already badge-scoped? If first segment matches badge, let it pass.
    if (first !== badge) {
      const url = req.nextUrl.clone();
      if (segments.length === 0) {
        url.pathname = `/${badge}`;
      } else if (PAGE_FEATURE_ROOTS.has(first)) {
        url.pathname = `/${badge}/${segments.join("/")}`;
      } else {
        // If path is unrecognized, leave it as-is (avoid over-eager redirects).
        return NextResponse.next();
      }
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
