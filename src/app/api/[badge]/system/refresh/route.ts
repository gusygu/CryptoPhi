import { NextRequest, NextResponse } from "next/server";
import { runSystemRefresh } from "@/core/system/refresh";
import { resolveCycleSeconds } from "@/core/settings/time";
import { getAppSessionId } from "@/core/system/appSession";
import { getCurrentSession, requireUserSession } from "@/app/(server)/auth/session";

export const runtime = "nodejs";

type RouteParams = { badge?: string };
type RouteContext = { params: RouteParams | Promise<RouteParams> };

async function resolveBadge(req: NextRequest, ctx?: RouteContext): Promise<string> {
  const params = ctx?.params ? await ctx.params : { badge: "" };
  const fromParams = params?.badge ?? "";
  const fromHeader = req.headers.get("x-app-session") || "";
  const fromPath = req.nextUrl.pathname.split("/").filter(Boolean)[1] ?? "";
  const badge = (fromParams || fromHeader || fromPath || "").trim();
  return badge || "global";
}

async function resolvePollerId(
  req: NextRequest,
  ctx?: RouteContext
): Promise<{ appSessionId: string; cycleMs: number }> {
  const badge = await resolveBadge(req, ctx);
  const sessionId = badge || getAppSessionId() || "global";
  const cycleSeconds = await resolveCycleSeconds(sessionId);
  return { appSessionId: sessionId, cycleMs: cycleSeconds * 1000 };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await requireUserSession();
    // Attach user context so user-space views (coin universe, timing) are per user
    await getCurrentSession().catch(() => null);

    const body = await req.json().catch(() => ({}));
    const symbols = Array.isArray(body?.symbols) ? body.symbols : undefined;
    const interval = typeof body?.interval === "string" ? body.interval : undefined;
    const { appSessionId, cycleMs } = await resolvePollerId(req, ctx);

    const result = await runSystemRefresh({
      symbols,
      klinesInterval: interval,
      pollerId: appSessionId,
      appSessionId,
    });
    return NextResponse.json({ ok: result.ok, cycleMs, appSessionId, result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  await requireUserSession();
  await getCurrentSession().catch(() => null);
  const symbols = req.nextUrl.searchParams.get("symbols");
  const interval = req.nextUrl.searchParams.get("interval") ?? undefined;
  const selected = symbols
    ? symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const { appSessionId, cycleMs } = await resolvePollerId(req, ctx);
  const result = await runSystemRefresh({
    symbols: selected,
    klinesInterval: interval,
    pollerId: appSessionId,
    appSessionId,
  });
  return NextResponse.json({ ok: result.ok, cycleMs, appSessionId, result });
}
