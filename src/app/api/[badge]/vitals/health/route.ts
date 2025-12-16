import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";
import { getPool } from "@/core/db/db_server";
import { buildHealthSnapshot } from "@/core/api/vitals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function unwrapBadge(context: { params?: { badge?: string } | Promise<{ badge?: string }> }): Promise<string | null> {
  const p = (context?.params && typeof (context as any).params?.then === "function")
    ? await (context as any).params
    : (context as any)?.params;
  return p?.badge ?? null;
}

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const badgeParam = await unwrapBadge(context);
  const resolved = await resolveBadgeRequestContext(req as any, { badge: badgeParam });
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = resolved.badge;
  const userId = resolved.session?.userId;
  if (!badge || !userId) {
    return NextResponse.json({ ok: false, error: "invalid_context" }, { status: 400 });
  }
  try {
    await setRequestContext({ userId, sessionId: badge });
    const pool = getPool();
    const r = await pool.query("SELECT now()");
    const snapshot = await buildHealthSnapshot({ coin: "BTC" });
    return NextResponse.json({
      ok: true,
      db: "up",
      now: r.rows?.[0]?.now ?? null,
      snapshot,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "internal_error", route: "vitals/health", message: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
