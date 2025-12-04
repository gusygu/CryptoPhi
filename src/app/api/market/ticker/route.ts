// src/app/api/market/ticker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchTickersForCoins } from "@/core/sources/binance";
import { resolveCoins } from "@/lib/coins/resolve";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const coins = await resolveCoins(url, { spotOnly: true });

    const tickers = await fetchTickersForCoins(coins);

    return NextResponse.json(
      {
        ok: true,
        coins,
        tickers,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

// POST / DELETE aren’t needed for v1.b.0; you can either omit them
// (Next will 404) or keep explicit 405s:

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "ticker runner disabled in v1.b.0" },
    { status: 405 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { ok: false, error: "ticker runner disabled in v1.b.0" },
    { status: 405 },
  );
}
