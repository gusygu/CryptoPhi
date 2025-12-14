import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export async function GET(
  _req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const resolved = await resolveBadgeRequestContext(_req, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const session = resolved.session;
  if (!session.isAdmin) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rows = await sql`
    SELECT
      report_id,
      owner_user_id,
      cycle_seq,
      category,
      severity,
      note,
      created_at,
      acknowledged_by,
      acknowledged_at
    FROM audit.user_reports
    ORDER BY created_at DESC
    LIMIT 200
  `;

  return NextResponse.json({ ok: true, items: rows });
}
