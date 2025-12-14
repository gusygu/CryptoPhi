// src/core/settings/time.ts
import { type PoolClient } from "pg";
import { query, withClient, withDbContext } from "@/core/db/pool_server";
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
export async function resolveCycleSeconds(
  appSessionId?: string | null,
  client?: PoolClient | null,
): Promise<number> {
  const session = String(appSessionId ?? getAppSessionId() ?? "").trim();

  try {
    if (session) {
      const fetcher = async (c: PoolClient) => {
        const { rows } = await c.query<{ cycle_seconds: number }>(
          `select cycle_seconds
             from user_space.v_poller_time
         order by (app_session_id = $1) desc, updated_at desc nulls last
            limit 1`,
          [session]
        );
        return clampSeconds(rows[0]?.cycle_seconds);
      };
      const val =
        client
          ? await fetcher(client)
          : await withDbContext(
              { userId: "system", sessionId: session },
              async (c) => fetcher(c),
            );
      if (val != null) return val;
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
