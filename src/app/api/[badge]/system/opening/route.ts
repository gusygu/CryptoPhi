import { NextRequest, NextResponse } from "next/server";
import { stampOpeningForSession } from "@/core/db/db";
import { requireUserSessionApi } from "@/app/(server)/auth/session";

export const runtime = "nodejs";

type RouteParams = { badge?: string };
type RouteContext = { params: RouteParams | Promise<RouteParams> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const params = ctx?.params ? await ctx.params : { badge: "" };
    const badge = params?.badge ?? "";
    const auth = await requireUserSessionApi(badge);
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
    const stamped = await stampOpeningForSession(badge);
    return NextResponse.json({
      ok: stamped.ok,
      appSessionId: badge,
      tsMs: stamped.tsMs,
      stamped: stamped.stamped,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
