// src/core/features/admin-logs/service.ts
import { getPool } from "@/core/db/db";
import type { ActionLogEntry } from "./types";

const pool = () => getPool();

export async function listActionLog(limit = 100): Promise<ActionLogEntry[]> {
  const q = await pool().query<ActionLogEntry>(
    `
    SELECT
      action_id        AS "actionId",
      actor_role       AS "actorRole",
      actor_email      AS "actorEmail",
      actor_manager_id AS "actorManagerId",
      action_kind      AS "actionKind",
      created_at       AS "createdAt",
      internal_admin_id AS "internalAdminId"
    FROM admin.v_action_log_enriched
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return q.rows;
}
