import { NextResponse } from "next/server";
import { requireUserSessionApi } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET() {
  const auth = await requireUserSessionApi("global");
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const session = auth.ctx;
  const rows = await sql`
    SELECT cycle_seq, status, summary, payload, created_at
    FROM audit.user_cycle_log
    WHERE owner_user_id = ${session.userId}
    ORDER BY cycle_seq DESC
    LIMIT 200
  `;
  return NextResponse.json({ ok: true, items: rows });
}
