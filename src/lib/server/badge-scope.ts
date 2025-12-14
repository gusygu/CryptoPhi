import { NextResponse, type NextRequest } from "next/server";

export type BadgeScope = {
  badgeParam: string | null;
  badgeHeader: string | null;
  badgeCookie: string | null;
  badgeQuery: string | null;
  legacyCookie: string | null;
  effectiveBadge: string | null;
  resolvedFromSessionMap: boolean;
};

export function resolveBadgeScope(
  req: NextRequest,
  params?: { badge?: string | null },
): BadgeScope {
  const badgeParam = params?.badge ? String(params.badge).trim() : null;
  const badgeHeader = (req.headers.get("x-app-session") || "").trim() || null;
  const badgeQuery = (req.nextUrl.searchParams.get("sessionId") || "").trim() || null;
  const badgeCookie = (req.cookies.get("sessionId")?.value || "").trim() || null;
  const legacyCookie =
    (req.cookies.get("appSessionId")?.value || req.cookies.get("app_session_id")?.value || "").trim() ||
    null;

  const effectiveBadge =
    badgeParam ||
    badgeHeader ||
    badgeQuery ||
    badgeCookie ||
    legacyCookie ||
    null;

  return {
    badgeParam,
    badgeHeader,
  badgeCookie,
  badgeQuery,
  legacyCookie,
  effectiveBadge,
  resolvedFromSessionMap: false,
  };
}

const BADGE_RE = /^[A-Za-z0-9_-]{2,64}$/;

function cleanBadge(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.toLowerCase() === "api") return null;
  if (!BADGE_RE.test(v)) return null;
  return v;
}

export function resolveBadgeOrThrow(
  req: NextRequest,
  params?: { badge?: string | null },
): string {
  const raw =
    params?.badge ??
    req.headers.get("x-app-session") ??
    req.cookies.get("sessionId")?.value ??
    null;
  const badge = cleanBadge(raw);
  if (!badge) {
    const code = raw ? "invalid_badge" : "badge_required";
    throw NextResponse.json({ error: code }, { status: 400 });
  }
  return badge;
}
