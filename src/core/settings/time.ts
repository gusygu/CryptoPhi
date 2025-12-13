// src/core/settings/time.ts
import { getPool, query } from "@/core/db/pool_server";
import { getAppSessionId } from "@/core/system/appSession";

const DEFAULT_CYCLE_SECONDS = Number(process.env.MATRICES_CYCLE_SECONDS ?? 80);

const clampSeconds = (x: number | null | undefined): number | null => {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.round(n));
};

/**
 * Resolve the cycle seconds for this app/session.
 * Priority:
 *  1) exact match on app_session_id
 *  2) global/null row (shared default)
 *  3) env MATRICES_CYCLE_SECONDS
 */
export async function resolveCycleSeconds(appSessionId?: string | null): Promise<number> {
  const session = String(appSessionId ?? getAppSessionId() ?? "").trim();

  try {
    if (session) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `select set_config('app.current_session_id', $1, true)`,
          [session]
        );
        const { rows } = await client.query<{ cycle_seconds: number }>(
          `select cycle_seconds
             from user_space.v_poller_time
         order by (app_session_id = $1) desc, updated_at desc nulls last
            limit 1`,
          [session]
        );
        await client.query("COMMIT");
        const val = clampSeconds(rows[0]?.cycle_seconds);
        if (val != null) {
          client.release();
          return val;
        }
        client.release();
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        client.release();
        throw err;
      }
    }

    const { rows: globals } = await query<{ cycle_seconds: number }>(
      `select cycle_seconds
         from settings.personal_time_settings
        where app_session_id is null or app_session_id = 'global'
        order by app_session_id is null desc
        limit 1`
    );
    const globalVal = clampSeconds(globals[0]?.cycle_seconds);
    if (globalVal != null) return globalVal;
  } catch {
    // fall through to env/default
  }

  return clampSeconds(DEFAULT_CYCLE_SECONDS) ?? 80;
}
