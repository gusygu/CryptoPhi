import { NextResponse } from "next/server";
import { requireUserSessionApi } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET() {
  const auth = await requireUserSessionApi("global");
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const session = auth.ctx;
  const rows = await sql`
    SELECT cycle_seq, symbol, window_label, sample_ts, status, message, meta, created_at
    FROM audit.str_sampling_log
    WHERE owner_user_id = ${session.userId}
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return NextResponse.json({ ok: true, items: rows });
}
