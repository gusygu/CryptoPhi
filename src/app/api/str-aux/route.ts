// src/app/api/str-aux/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "legacy str-aux runner disabled in v1.b.0",
    },
    { status: 501 },
  );
}
