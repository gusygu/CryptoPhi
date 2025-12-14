import { NextRequest, NextResponse } from "next/server";
import { runSystemRefresh } from "@/core/system/refresh";
import { resolveCycleSeconds } from "@/core/settings/time";
import { getAppSessionId } from "@/core/system/appSession";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { adoptSessionRequestContext } from "@/lib/server/request-context";

export const runtime = "nodejs";

type RouteParams = { badge?: string };
type RouteContext = { params: RouteParams | Promise<RouteParams> };

async function resolvePollerId(
  badge: string,
): Promise<{ appSessionId: string; cycleMs: number }> {
  const sessionId = badge || getAppSessionId() || "global";
  const cycleSeconds = await resolveCycleSeconds(sessionId);
  return { appSessionId: sessionId, cycleMs: cycleSeconds * 1000 };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const params = ctx?.params ? await ctx.params : { badge: "" };
    const resolved = await resolveBadgeRequestContext(req, params);
    if (!resolved.ok) {
      return NextResponse.json(resolved.body, { status: resolved.status });
    }
    const badge = resolved.badge;
    const session = resolved.session;
    adoptSessionRequestContext({ ...session, sessionId: badge });

    const body = await req.json().catch(() => ({}));
    const symbols = Array.isArray(body?.symbols) ? body.symbols : undefined;
    const interval = typeof body?.interval === "string" ? body.interval : undefined;
    const { appSessionId, cycleMs } = await resolvePollerId(badge);

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
  const params = ctx?.params ? await ctx.params : { badge: "" };
  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }
  const badge = resolved.badge;
  const session = resolved.session;
  adoptSessionRequestContext({ ...session, sessionId: badge });
  const symbols = req.nextUrl.searchParams.get("symbols");
  const interval = req.nextUrl.searchParams.get("interval") ?? undefined;
  const selected = symbols
    ? symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const { appSessionId, cycleMs } = await resolvePollerId(badge);
  const result = await runSystemRefresh({
    symbols: selected,
    klinesInterval: interval,
    pollerId: appSessionId,
    appSessionId,
  });
  return NextResponse.json({ ok: result.ok, cycleMs, appSessionId, result });
}
