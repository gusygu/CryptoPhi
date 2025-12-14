import { NextRequest, NextResponse } from "next/server";
import { applyMoveAndHydrate } from "@/core/features/cin-aux";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { withDbContext } from "@/core/db/pool_server";

export async function POST(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  try {
    // Ensure request context carries user/badge for RLS-scoped tables.
    const params =
      typeof (context as any)?.params?.then === "function"
        ? await (context as { params: Promise<{ badge?: string }> }).params
        : (context as { params: { badge?: string } }).params;
    const resolved = await resolveBadgeRequestContext(req, params);
    if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
    const badge = resolved.badge;
    const session = resolved.session;

    const body = await req.json();
    const res = await withDbContext(
      {
        userId: session.userId,
        sessionId: badge,
        isAdmin: session.isAdmin,
        path: req.nextUrl.pathname,
        badgeParam: params?.badge ?? null,
        resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
      },
      async () =>
        applyMoveAndHydrate({
          sessionId: body.sessionId,
          ts: body.ts ?? new Date().toISOString(),
          fromAsset: body.fromAsset,
          toAsset: body.toAsset,
          units: body.units,
          priceUsdt: body.priceUsdt,
          feeUsdt: body.feeUsdt,
          slippageUsdt: body.slippageUsdt,
          bridgeInUsdt: body.bridgeInUsdt,
          bridgeOutUsdt: body.bridgeOutUsdt,
          devRefUsdt: body.devRefUsdt,
          refTargetUsdt: body.refTargetUsdt ?? null,
          note: body.note ?? null,
        }),
    );
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
