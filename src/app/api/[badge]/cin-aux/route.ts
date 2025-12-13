import { NextRequest, NextResponse } from "next/server";
import { applyMoveAndHydrate } from "@/core/features/cin-aux";
import { requireUserSession } from "@/app/(server)/auth/session";

export async function POST(req: NextRequest) {
  try {
    // Ensure request context carries user/badge for RLS-scoped tables.
    await requireUserSession();
    const body = await req.json();
    const res = await applyMoveAndHydrate({
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
    });
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}
