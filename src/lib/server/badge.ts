// src/lib/server/badge.ts
// Resolve the current badge / app_session_id from request headers or cookies.
import { headers, cookies } from "next/headers";

type ResolveBadgeOptions = {
  allowLegacy?: boolean;
  defaultToGlobal?: boolean;
};

export async function resolveRequestBadge(
  opts: ResolveBadgeOptions = {},
): Promise<string | null> {
  const allowLegacy = opts.allowLegacy ?? false;
  const defaultToGlobal = opts.defaultToGlobal ?? true;

  try {
    const h = await headers();
    const c = await cookies();
    const headerBadge = (h.get("x-app-session") || "").trim();
    const cookieBadge = (c.get("sessionId")?.value || "").trim();
    const legacyBadge = allowLegacy
      ? (c.get("appSessionId")?.value ||
         c.get("app_session_id")?.value ||
         "").trim()
      : "";

    const candidate = headerBadge || cookieBadge || legacyBadge;
    if (candidate) return candidate;
    return defaultToGlobal ? "global" : null;
  } catch {
    return defaultToGlobal ? "global" : null;
  }
}
