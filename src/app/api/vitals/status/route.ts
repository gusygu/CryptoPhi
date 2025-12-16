import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeScope } from "@/lib/server/badge-scope";
import { requireUserSessionApi } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";
import { sql } from "@/core/db/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StatusLabel = "UP" | "DOWN" | "AUTH" | "UNKNOWN";

export async function GET(req: NextRequest) {
  const ts = new Date().toISOString();
  const badgeScope = resolveBadgeScope(req);
  const badge = badgeScope.effectiveBadge ?? null;

  let label: StatusLabel = "UNKNOWN";
  let ok = false;
  let userId: string | null = null;
  let sessionId: string | null = badge;
  let resolvedFromSessionMap = false;

  if (!badge) {
    label = "AUTH";
  } else {
    try {
      const auth = await requireUserSessionApi(badge, req);
      if (auth.ok) {
        const session = auth.ctx;
        userId = session.userId;
        sessionId = badge;
        resolvedFromSessionMap = session.resolvedFromSessionMap ?? false;
        await setRequestContext({
          userId,
          sessionId: badge,
          isAdmin: session.isAdmin,
          badgeParam: badgeScope.badgeParam ?? null,
          resolvedFromSessionMap,
          path: new URL(req.url).pathname,
        });
        label = "UP";
        ok = true;
      } else {
        label = "AUTH";
      }
    } catch {
      label = "AUTH";
    }
  }

  let dbOk = false;
  let dbLatencyMs: number | null = null;
  let dbPid: number | null = null;
  let dbNow: string | null = null;
  try {
    const dbStart = performance.now();
    const rows = await sql<{ pid: number; now: string }>`SELECT pg_backend_pid() AS pid, now() AS now`;
    dbLatencyMs = performance.now() - dbStart;
    dbPid = rows[0]?.pid ?? null;
    dbNow = rows[0]?.now ?? null;
    dbOk = true;
  } catch {
    dbLatencyMs = dbLatencyMs ?? null;
    dbOk = false;
    if (label === "UP") label = "DOWN";
    ok = false;
  }

  return NextResponse.json({
    ok: ok && dbOk,
    label,
    ts,
    userId,
    sessionId,
    badge,
    lastUpdated: ts,
    db: { ok: dbOk, latencyMs: dbLatencyMs, pid: dbPid, now: dbNow },
  });
}
