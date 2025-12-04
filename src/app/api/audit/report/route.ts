// src/app/api/audit/report/route.ts
import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";
import { sendAuditReportMail } from "@/core/mail/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const session = await requireUserSession();
  const body = await req.json().catch(() => ({}));

  const {
    cycleSeq,
    category = "issue",
    severity = "medium",
    note = "",
  } = body as {
    cycleSeq?: number;
    category?: string;
    severity?: string;
    note?: string;
  };

  if (!note.trim()) {
    return NextResponse.json(
      { ok: false, error: "Message is required." },
      { status: 400 },
    );
  }

  // 1) Insert into user_reports
  const [report] = await sql/* sql */`
    insert into audit.user_reports (
      owner_user_id, cycle_seq, category, severity, note
    )
    values (
      ${session.userId},
      ${cycleSeq ?? null},
      ${category},
      ${severity},
      ${note}
    )
    returning
      report_id,
      owner_user_id,
      cycle_seq,
      category,
      severity,
      note,
      created_at
  `;

  // 2) Optionally insert into error_queue for non-suggestion items, if you want
  if (category !== "suggestion") {
    await sql/* sql */`
      insert into audit.error_queue (
        owner_user_id, cycle_seq, summary, details, status
      )
      values (
        ${session.userId},
        ${cycleSeq ?? null},
        ${`User ${category} report (${severity})`},
        ${JSON.stringify({ note, from_report_id: report.report_id })},
        'open'
      )
    `;
  }

  // 3) Send email to admins
  const userEmail = session.email ?? (await sql/* sql */`
    select email
    from auth."user"
    where user_id = ${session.userId}
    limit 1
  `)[0]?.email ?? "unknown@user";

  void sendAuditReportMail({
    reportId: report.report_id,
    userId: report.owner_user_id,
    userEmail,
    cycleSeq: report.cycle_seq,
    category: (category as any) || "issue",
    severity,
    note,
    createdAt: report.created_at,
  });

  return NextResponse.json({ ok: true, reportId: report.report_id });
}
