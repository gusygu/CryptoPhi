import { NextResponse } from "next/server";
import { requireUserSessionApi } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET(
  _req: Request,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const badge = params?.badge ?? "";
  const auth = await requireUserSessionApi(badge);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const session = auth.ctx;
  if (!session.isAdmin) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const rows = await sql`
    SELECT error_id, origin, owner_user_id, cycle_seq, summary, details, status, created_at
    FROM audit.error_queue
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return NextResponse.json({ ok: true, items: rows });
}
