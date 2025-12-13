import { NextResponse, type NextRequest } from "next/server";

// Engine/global routes (shared across users).
const ENGINE_ROOTS = new Set([
  "audit",
  "auth",
  "converter",
  "invite",
  "market",
  "ops",
  "pipeline",
  "poller",
  "preview",
  "system",
  "vitals",
]);

// User/badge-scoped routes (all others).
const USER_ROOTS = new Set([
  "admin",
  "cin-aux",
  "dynamics",
  "dynamics_legacy",
  "matrices",
  "mea-aux",
  "mgmt",
  "moo-aux",
  "profile",
  "settings",
  "snapshot",
  "str-aux",
  "trade",
  "system",
  "user-invite",
]);

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
  const segments = pathname.split("/").filter(Boolean);

  // ---- Non-API: redirect to badge-scoped path (except auth/docs/info/static)
  if (!pathname.startsWith("/api/")) {
    const first = segments[0] ?? "";
    const isStatic =
      first.startsWith("_next") ||
      first === "favicon.ico" ||
      first === "robots.txt" ||
      first === "sitemap.xml" ||
      first === "assets";

    if (!isStatic && !PAGE_GLOBAL_ROOTS.has(first)) {
      const fromCookie =
        req.cookies.get("sessionId")?.value || "";
      const badge = (fromCookie || "global").trim() || "global";

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

  // ---- API handling (existing logic)
  // segments = ["api", "engine"|"user", ...rest]
  const [, first, ...rest] = segments;

  if (!first || rest.length === 0) return NextResponse.next();

  const pickBadge = (): string => {
    const qp = req.nextUrl.searchParams.get("sessionId");
    const fromHeader = req.headers.get("x-app-session");
    const fromCookie = req.cookies.get("sessionId")?.value;
    const badge = (qp || fromHeader || fromCookie || "").trim();
    return badge || "global";
  };

  // /api/engine/<root>/... => global/system scope
  if (first === "engine" && rest.length) {
    const [root] = rest;
    if (!ENGINE_ROOTS.has(root)) return NextResponse.next();
    const headers = new Headers(req.headers);
    headers.set("x-app-session", "global");
    return NextResponse.next({ request: { headers } });
  }

  // Legacy global: /api/<engine-root>/... => rewrite to /api/engine/<root>/...
  if (ENGINE_ROOTS.has(first)) {
    const url = req.nextUrl.clone();
    url.pathname = ["/api", "engine", first, ...rest].join("/");
    const headers = new Headers(req.headers);
    headers.set("x-app-session", "global");
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // /api/{user}/<user-root>/... => user-scoped; carry user badge as app session id
  if (USER_ROOTS.has(rest[0] ?? "")) {
    const userBadge = first.trim() || pickBadge();
    const headers = new Headers(req.headers);
    headers.set("x-app-session", userBadge);
    return NextResponse.next({ request: { headers } });
  }

  // Legacy user: /api/<user-root>/... => rewrite to /api/{badge}/<user-root>/...
  if (USER_ROOTS.has(first)) {
    const userBadge = pickBadge();
    const url = req.nextUrl.clone();
    url.pathname = ["/api", userBadge, first, ...rest].join("/");
    const headers = new Headers(req.headers);
    headers.set("x-app-session", userBadge);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
