// src/lib/server/badge.ts
// Resolve the current badge / app_session_id from request headers or cookies.
import { headers, cookies } from "next/headers";

type ResolveBadgeOptions = {
  allowLegacy?: boolean;
  defaultToGlobal?: boolean;
  useCookies?: boolean;
};

export async function resolveRequestBadge(
  opts: ResolveBadgeOptions = {},
): Promise<string | null> {
  const allowLegacy = opts.allowLegacy ?? false;
  const defaultToGlobal = opts.defaultToGlobal ?? true;
  const useCookies = opts.useCookies ?? true;

  try {
    const h = await headers();
    const c = useCookies ? await cookies() : null;
    const headerBadge = (h.get("x-app-session") || "").trim();
    const cookieBadge = useCookies ? (c?.get("sessionId")?.value || "").trim() : "";
    const legacyBadge =
      useCookies && allowLegacy
        ? (c?.get("appSessionId")?.value ||
           c?.get("app_session_id")?.value ||
           "").trim()
        : "";

    const candidate = headerBadge || cookieBadge || legacyBadge;
    if (candidate) return candidate;
    return defaultToGlobal ? "global" : null;
  } catch {
    return defaultToGlobal ? "global" : null;
  }
}
