import { NextRequest, NextResponse } from "next/server";
import { stampOpeningForSession } from "@/core/db/db";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { withDbContext } from "@/core/db/pool_server";

export const runtime = "nodejs";

type RouteParams = { badge?: string };
type RouteContext = { params: RouteParams | Promise<RouteParams> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const params = ctx?.params ? await ctx.params : { badge: "" };
    const resolved = await resolveBadgeRequestContext(req, params);
    if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
    const badge = resolved.badge;
    const stamped = await withDbContext(
      {
        userId: resolved.session.userId,
        sessionId: badge,
        isAdmin: resolved.session.isAdmin,
        path: req.nextUrl.pathname,
        badgeParam: params?.badge ?? null,
        resolvedFromSessionMap: (resolved.session as any)?.resolvedFromSessionMap ?? false,
      },
      async () => stampOpeningForSession(badge),
    );
    return NextResponse.json({
      ok: stamped.ok,
      appSessionId: badge,
      tsMs: stamped.tsMs,
      stamped: stamped.stamped,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
