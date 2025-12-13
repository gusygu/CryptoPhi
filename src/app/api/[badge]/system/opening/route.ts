import { NextRequest, NextResponse } from "next/server";
import { stampOpeningForSession } from "@/core/db/db";
import { requireUserSession } from "@/app/(server)/auth/session";

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

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await requireUserSession();
    const badge = await resolveBadge(req, ctx);
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
