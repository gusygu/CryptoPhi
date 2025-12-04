import { NextResponse } from "next/server";
import { buildStatusReport } from "@/core/api/vitals";

export async function GET() {
  return NextResponse.json(buildStatusReport());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const ts = Date.now();
  return NextResponse.json(
    {
      ok: true,
      id: `status:${ts}`,
      echo: body ?? null,
      next: {
        poll: "/api/vitals/status",
      },
      ts,
    },
    { status: 200 },
  );
}
