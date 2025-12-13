// str-aux ingest (orderbook-only)
// This route is intentionally disabled for kline ingestion. Use /api/[badge]/str-aux/sources/ingest/bins for OB ticks.

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "str-aux kline ingestion is disabled; use /api/[badge]/str-aux/sources/ingest/bins for orderbook ticks",
    },
    { status: 410 },
  );
}
