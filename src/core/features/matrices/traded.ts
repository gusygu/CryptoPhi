// traded.ts - helpers to resolve benchmark grids stamped at trade time

import { query } from "@/core/db/db_server";
import { normalizeSessionId } from "@/core/db/db";

export type TradedGrid = { ts: number | null; grid: (number | null)[][] };

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

export async function fetchTradedBenchmarkGrid(
  coins: readonly string[],
  appSessionId?: string | null
): Promise<TradedGrid> {
  const normalizedCoins = coins.map((c) => c.toUpperCase());
  const fallback = emptyGrid(normalizedCoins.length);
  const sessionKey = await normalizeSessionId(appSessionId);

  try {
    const { rows: stampRows } = await query<{ ts_ms: string | number | null }>(
      `
        SELECT MAX(ts_ms) AS ts_ms
          FROM matrices.dyn_values
         WHERE matrix_type = 'benchmark'
           AND trade_stamp = TRUE
           AND coalesce(meta->>'app_session_id','global') = $1
      `,
      [sessionKey]
    );
    const tsRaw = stampRows[0]?.ts_ms;
    const tsMs = tsRaw == null ? null : Number(tsRaw);
    if (!Number.isFinite(tsMs)) {
      return { ts: null, grid: fallback };
    }

    const { rows } = await query<{ base: string; quote: string; value: number }>(
      `
        SELECT base, quote, value
          FROM matrices.dyn_values
         WHERE matrix_type = 'benchmark'
           AND trade_stamp = TRUE
           AND ts_ms = $1
           AND coalesce(meta->>'app_session_id','global') = $2
      `,
      [tsMs, sessionKey]
    );

    if (!rows.length) {
      return { ts: tsMs, grid: fallback };
    }

    return { ts: tsMs, grid: rowsToGrid(normalizedCoins, rows as any) };
  } catch {
    return { ts: null, grid: fallback };
  }
}
