import { NextResponse } from "next/server";
import { getPool } from "@/core/db/db_server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const ts = Date.now();
  const pool = getPool();
  const dbStart = performance.now();
  let dbOk = false;
  let latencyMs = null as number | null;
  try {
    const res = await pool.query<{ now: string }>("SELECT now()");
    latencyMs = performance.now() - dbStart;
    dbOk = Array.isArray(res.rows) && res.rows.length > 0;
    return NextResponse.json({
      ok: dbOk,
      ts,
      uptimeSec: Math.floor(process.uptime()),
      db: { ok: dbOk, latencyMs, now: res.rows[0]?.now ?? null },
    });
  } catch (err: any) {
    latencyMs = performance.now() - dbStart;
    return NextResponse.json(
      {
        ok: false,
        ts,
        uptimeSec: Math.floor(process.uptime()),
        db: { ok: false, latencyMs, error: String(err?.message ?? err) },
      },
      { status: 500 },
    );
  }
}
