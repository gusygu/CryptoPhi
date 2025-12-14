// src/lib/server/isolation-log.ts
// Lightweight, optional structured logging for isolation debugging.

type IsolationLogInput = {
  route: string;
  badgeParam?: string | null;
  effectiveBadge?: string | null;
  cookieBadge?: string | null;
  userId?: string | null;
  resolvedFromSessionMap?: boolean;
  coinUniverse?: string[] | null;
  extra?: Record<string, unknown>;
};

const DEBUG_FLAG =
  process.env.DEBUG_ISOLATION === "1" ||
  process.env.DEBUG_ISOLATION === "true" ||
  process.env.NODE_ENV === "development";

export function logIsolation(ctx: IsolationLogInput) {
  if (!DEBUG_FLAG) return;
  try {
    const payload = {
      tag: "isolation_debug",
      ...ctx,
    };
    console.info(JSON.stringify(payload));
  } catch {
    // best effort
  }
}
