import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import { sql } from "@/core/db/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SystemSummaryRow = {
  total_cycles: number | null;
  total_cycles_non_ok: number | null;
  last_cycle_created_at: string | null;
  total_sampling: number | null;
  total_sampling_non_ok: number | null;
  last_sampling_created_at: string | null;
  total_reports: number | null;
  total_errors: number | null;
  total_errors_open: number | null;
  last_error_created_at: string | null;
  last_vitals_ts: string | null;
  last_vitals_payload: Record<string, unknown> | null;
};

type NoisyUserRow = {
  owner_user_id: string;
  email: string;
  total_cycles_non_ok: number;
  total_sampling_non_ok: number;
  total_errors_open: number;
};

export async function GET() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const [summaryRow] = await sql<SystemSummaryRow>`
    SELECT
      (SELECT COUNT(*) FROM audit.user_cycle_log)::int AS total_cycles,
      (SELECT COUNT(*) FROM audit.user_cycle_log WHERE status <> 'ok')::int AS total_cycles_non_ok,
      (SELECT MAX(created_at) FROM audit.user_cycle_log) AS last_cycle_created_at,
      (SELECT COUNT(*) FROM audit.str_sampling_log)::int AS total_sampling,
      (SELECT COUNT(*) FROM audit.str_sampling_log WHERE status <> 'ok')::int AS total_sampling_non_ok,
      (SELECT MAX(created_at) FROM audit.str_sampling_log) AS last_sampling_created_at,
      (SELECT COUNT(*) FROM audit.user_reports)::int AS total_reports,
      (SELECT COUNT(*) FROM audit.error_queue)::int AS total_errors,
      (SELECT COUNT(*) FROM audit.error_queue WHERE status = 'open')::int AS total_errors_open,
      (SELECT MAX(created_at) FROM audit.error_queue) AS last_error_created_at,
      (SELECT snapshot_ts FROM audit.vitals_log ORDER BY snapshot_ts DESC LIMIT 1) AS last_vitals_ts,
      (SELECT payload FROM audit.vitals_log ORDER BY snapshot_ts DESC LIMIT 1) AS last_vitals_payload
  `;

  const summary = {
    total_cycles: summaryRow?.total_cycles ?? 0,
    total_cycles_non_ok: summaryRow?.total_cycles_non_ok ?? 0,
    last_cycle_created_at: summaryRow?.last_cycle_created_at ?? null,
    total_sampling: summaryRow?.total_sampling ?? 0,
    total_sampling_non_ok: summaryRow?.total_sampling_non_ok ?? 0,
    last_sampling_created_at: summaryRow?.last_sampling_created_at ?? null,
    total_reports: summaryRow?.total_reports ?? 0,
    total_errors: summaryRow?.total_errors ?? 0,
    total_errors_open: summaryRow?.total_errors_open ?? 0,
    last_error_created_at: summaryRow?.last_error_created_at ?? null,
    last_vitals_ts: summaryRow?.last_vitals_ts ?? null,
    last_vitals_payload: summaryRow?.last_vitals_payload ?? null,
  };

  const noisyUsers = await sql<NoisyUserRow>`
    SELECT
      owner_user_id,
      email,
      COALESCE(cycle_issues, 0)::int AS total_cycles_non_ok,
      COALESCE(sampling_issues, 0)::int AS total_sampling_non_ok,
      COALESCE(open_errors, 0)::int AS total_errors_open
    FROM audit.v_user_audit_summary
    WHERE
      COALESCE(cycle_issues, 0) + COALESCE(sampling_issues, 0) + COALESCE(open_errors, 0) > 0
    ORDER BY
      COALESCE(cycle_issues, 0) + COALESCE(sampling_issues, 0) + COALESCE(open_errors, 0) DESC,
      owner_user_id
    LIMIT 20
  `;

  return NextResponse.json({ ok: true, summary, noisyUsers });
}
