import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/app/api/_lib/responses";
import { requireAdmin } from "@/app/api/engine/invite/_admin";
import { sql } from "@/core/db/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeLegacyRow(row: any) {
  return {
    request_id: row.request_id,
    email: row.email,
    nickname: row.nickname ?? null,
    note: row.note ?? row.message ?? null,
    status: row.status,
    requested_from_ip: row.requested_from_ip ?? null,
    requested_user_agent: row.requested_user_agent ?? null,
    approved_by_user_id: row.approved_by_user_id ?? null,
    rejected_by_user_id: row.rejected_by_user_id ?? null,
    approved_at: row.approved_at ?? null,
    rejected_at: row.rejected_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

async function fetchInviteRows(status: string, limit: number): Promise<any[]> {
  try {
    const rows =
      status === "all"
        ? await sql`
            SELECT
              request_id,
              email,
              nickname,
              note,
              status,
              requested_from_ip,
              requested_user_agent,
              approved_by_user_id,
              rejected_by_user_id,
              approved_at,
              rejected_at,
              created_at,
              updated_at
            FROM auth.invite_request
            ORDER BY created_at DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT
              request_id,
              email,
              nickname,
              note,
              status,
              requested_from_ip,
              requested_user_agent,
              approved_by_user_id,
              rejected_by_user_id,
              approved_at,
              rejected_at,
              created_at,
              updated_at
            FROM auth.invite_request
            WHERE status = ${status}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `;
    return rows.map(normalizeLegacyRow);
  } catch (err: any) {
    const missingColumn =
      typeof err?.message === "string" &&
      err.message.includes("column") &&
      err.message.includes("does not exist");
    if (err?.code !== "42703" && !missingColumn) {
      throw err;
    }
    const rows =
      status === "all"
        ? await sql`
            SELECT
              request_id,
              email,
              nickname,
              message,
              status,
              decided_by AS approved_by_user_id,
              decided_by AS rejected_by_user_id,
              decided_at AS approved_at,
              NULL::timestamptz AS rejected_at,
              created_at,
              decided_at AS updated_at
            FROM auth.invite_request
            ORDER BY created_at DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT
              request_id,
              email,
              nickname,
              message,
              status,
              decided_by AS approved_by_user_id,
              decided_by AS rejected_by_user_id,
              decided_at AS approved_at,
              NULL::timestamptz AS rejected_at,
              created_at,
              decided_at AS updated_at
            FROM auth.invite_request
            WHERE status = ${status}
            ORDER BY created_at DESC
            LIMIT ${limit}
          `;
    return rows.map(normalizeLegacyRow);
  }
}

export async function GET(req: NextRequest) {
  try {
    const adminCheck = await requireAdmin();
    if (!adminCheck.ok) {
      return adminCheck.response!;
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

    const items = await fetchInviteRows(status, limit);

    return jsonOk({ items });
  } catch (err: any) {
    console.error("[api/invite/list] failed", err);
    return jsonError("INVITE_LIST_FAILED", err?.message ?? "Failed to list invite requests", 500);
  }
}
