// src/app/api/pipeline/auto/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Legacy auto-refresh pipeline is disabled in v1.b.0.
// These endpoints just respond with a static status for now.

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      running: false,
      started: false,
      note: "legacy pipeline auto-refresh disabled in v1.b.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      ok: true,
      stopped: true,
      note: "legacy pipeline auto-refresh disabled in v1.b.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
