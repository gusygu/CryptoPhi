// src/app/api/audit/summary/route.ts
import { NextResponse } from "next/server";
import { requireUserSessionApi } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const auth = await requireUserSessionApi("global");
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const userId = auth.ctx.userId;

  const [row] = await sql`
    SELECT owner_user_id, email,
           last_cycle_seq, last_cycle_at,
           cycle_issues, sampling_issues,
           total_reports, open_errors
    FROM audit.v_user_audit_summary
    WHERE owner_user_id = ${userId}
    LIMIT 1
  `;

  return NextResponse.json({
    ok: true,
    summary: row ?? null,
  });
}
