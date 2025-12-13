// trade.ts - helpers to resolve trade-stamped benchmark snapshots

import { query } from "@/core/db/db_server";
import { getNearestTsAtOrBefore, getSnapshotByType, normalizeSessionId } from "@/core/db/db";

export type TradeGrid = { ts: number | null; grid: (number | null)[][] };

function emptyGrid(length: number): (number | null)[][] {
  return Array.from({ length }, () => Array.from({ length }, () => null as number | null));
}

function rowsToGrid(
  coins: readonly string[],
  rows: { base: string; quote: string; value: number }[]
): (number | null)[][] {
  const n = coins.length;
  const grid = emptyGrid(n);
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.base.toUpperCase()}/${row.quote.toUpperCase()}`;
    map.set(key, Number(row.value));
  }
  for (let i = 0; i < n; i++) {
    const base = coins[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const quote = coins[j]!;
      const key = `${base}/${quote}`;
      grid[i][j] = map.has(key) ? map.get(key)! : null;
    }
  }
  return grid;
}

export async function fetchTradeBenchmarkGrid(
  coins: readonly string[],
  appSessionId?: string | null
): Promise<TradeGrid> {
  const normalized = coins.map((c) => c.toUpperCase());
  const fallback = emptyGrid(normalized.length);
  const sessionKey = await normalizeSessionId(appSessionId);

  try {
    const { rows } = await query<{ ts_ms: string | null | number }>(
      `
        SELECT (max(EXTRACT(EPOCH FROM trade_ts)) * 1000)::bigint AS ts_ms
          FROM matrices.dyn_values
         WHERE matrix_type = 'benchmark_trade'
           AND trade_stamp = true
           AND coalesce(meta->>'app_session_id','global') = $1
      `,
      [sessionKey]
    );

    const tsRaw = rows[0]?.ts_ms;
    if (tsRaw == null) return { ts: null, grid: fallback };
    const stampMs = Number(tsRaw);
    if (!Number.isFinite(stampMs)) return { ts: null, grid: fallback };

    const tsMs = await getNearestTsAtOrBefore("benchmark_trade", stampMs, sessionKey);
    if (!Number.isFinite(tsMs)) {
      return { ts: null, grid: fallback };
    }

    const snapshotRows = await getSnapshotByType("benchmark_trade", tsMs!, normalized, sessionKey);
    if (!snapshotRows.length) {
      return { ts: tsMs!, grid: fallback };
    }

    return { ts: tsMs!, grid: rowsToGrid(normalized, snapshotRows as any) };
  } catch {
    return { ts: null, grid: fallback };
  }
}
