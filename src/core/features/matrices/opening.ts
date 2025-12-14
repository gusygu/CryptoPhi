// src/core/features/matrices/opening.ts
// Opening grid helper backed by market.klines (Binance-ingested data).

import { db } from "@/core/db/db";
import type { PoolClient } from "pg";

export type OpeningArgs = {
  coins: string[];           // uppercase coin universe
  quote?: string;            // default "USDT"
  appSessionId?: string | null;
  window?: string;           // e.g. "1h"
  openingTs?: number;        // optional override (ms)
};

type Grid = (number | null)[][];
const makeGrid = (n: number) =>
  Array.from({ length: n }, () => Array(n).fill(null as number | null));

const DEFAULT_WINDOW = "1h";
const openingTsCache = new Map<string, number>();
const cacheKeyForOpening = (args: OpeningArgs, window: string, pivot: string) =>
  `${args.appSessionId ?? "global"}|${window}|${pivot}`;

async function loadOpeningFromDynValues(
  coins: string[],
  appSessionId?: string | null,
  client?: PoolClient | null
): Promise<{ ts: number; grid: Grid } | null> {
  if (!coins.length) return null;
  const upperCoins = coins.map((c) => c.toUpperCase());
  const grid = makeGrid(upperCoins.length);
  const idx = new Map<string, number>();
  upperCoins.forEach((c, i) => idx.set(c, i));
  const sessionKey = (appSessionId ?? "global").trim() || "global";

  try {
    const executor = client ? client.query.bind(client) : db.query.bind(db);
    const { rows } = await executor<{
      base: string;
      quote: string;
      value: string | number;
      ots: string | null;
      ts_ms: string | number;
    }>(
      `
      WITH latest AS (
        SELECT
          ts_ms,
          COALESCE(opening_ts, to_timestamp(ts_ms / 1000.0)) AS ots
        FROM matrices.dyn_values
        WHERE matrix_type = 'benchmark'
          AND opening_stamp = TRUE
          AND COALESCE(meta->>'app_session_id','global') = $2
        ORDER BY ots DESC NULLS LAST, ts_ms DESC
        LIMIT 1
      )
      SELECT dv.base, dv.quote, dv.value, l.ots, l.ts_ms
        FROM matrices.dyn_values dv
        JOIN latest l
          ON l.ts_ms = dv.ts_ms
       WHERE dv.matrix_type = 'benchmark'
         AND dv.base  = ANY($1::text[])
         AND dv.quote = ANY($1::text[])
      `,
      [upperCoins, sessionKey]
    );

    if (!rows?.length) return null;

    const first = rows[0]!;
    const tsMs = Number(first.ts_ms);
    const tsFromOpening = first.ots ? Date.parse(first.ots) : tsMs;
    const effectiveTs = Number.isFinite(tsFromOpening) ? tsFromOpening : tsMs;

    for (const row of rows) {
      const b = String(row.base ?? "").toUpperCase();
      const q = String(row.quote ?? "").toUpperCase();
      const bi = idx.get(b);
      const qj = idx.get(q);
      if (bi == null || qj == null || bi === qj) continue;
      const v = Number(row.value);
      if (!Number.isFinite(v)) continue;
      grid[bi][qj] = v;
    }

    return { ts: effectiveTs, grid };
  } catch {
    return null;
  }
}

export async function fetchOpeningGridFromView(
  args: OpeningArgs & { client?: PoolClient | null }
): Promise<{ ts: number; grid: Grid }> {
  const coins = Array.from(new Set(args.coins.map((c) => c.toUpperCase())));
  const n = coins.length;
  const windowLabel = (args.window ?? DEFAULT_WINDOW).toLowerCase();
  const pivot = (args.quote ?? "USDT").toUpperCase();
  const cacheKey = cacheKeyForOpening(args, windowLabel, pivot);

  const dbOpening = await loadOpeningFromDynValues(coins, args.appSessionId, args.client ?? null);
  if (dbOpening) {
    openingTsCache.set(cacheKey, dbOpening.ts);
    return { ts: dbOpening.ts, grid: dbOpening.grid };
  }

  // No opening for this session; return empty grid so pct_ref stays null
  const grid = makeGrid(n);
  const ts = args.openingTs ?? openingTsCache.get(cacheKey) ?? Date.now();
  openingTsCache.set(cacheKey, ts);
  return { ts, grid };
}

export async function getOpeningPairValue(args: {
  base: string;
  quote: string;
  appSessionId?: string | null;
  window?: string;
  openingTs?: number;
  client?: PoolClient | null;
}): Promise<{ ts: number | null; price: number | null }> {
  const { base, quote } = args;
  const { grid, ts } = await fetchOpeningGridFromView({
    coins: [base.toUpperCase(), quote.toUpperCase()],
    quote: quote.toUpperCase(),
    appSessionId: args.appSessionId ?? null,
    window: args.window ?? DEFAULT_WINDOW,
    openingTs: args.openingTs,
    client: args.client ?? null,
  });
  return { ts, price: grid?.[0]?.[1] ?? null };
}
