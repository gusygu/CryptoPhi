// src/core/system/tasks.ts
import { db } from "@/core/db/server";
import { buildMarketKlineParams, normalizeKlineRow } from "./inflow";

import { fetchKlines as fetchKlinesFromSource, fetchTicker24h } from "@/core/sources/binance";

export async function ingestTickerSymbols(symbols: string[]): Promise<number> {
  if (!symbols.length) return 0;
  let count = 0;
  for (const symbol of symbols) {
    const sym = symbol.toUpperCase();
    const t = await fetchTicker24h(sym);
    const payload = {
      s: t.symbol ?? sym,
      c: t.lastPrice ?? t.weightedAvgPrice ?? null,
      E: Date.now(),
      T: Date.now(),
    };
    await db.query(`select market.apply_ticker_from_payload($1,$2::jsonb)`, [
      sym,
      JSON.stringify(payload),
    ]);
    count++;
  }
  return count;
}

export async function ingestKlinesSymbols(
  symbols: string[],
  interval: string,
  limit = 200
): Promise<number> {
  if (!symbols.length) return 0;
  const sourceTag = "binance_rest";
  // Ensure the window label exists to satisfy FK on market.klines.
  await db.query(`select settings.upsert_window($1::text)`, [interval]);
  let rows = 0;
  for (const symbol of symbols) {
    const sym = symbol.toUpperCase();
    const klines = await fetchKlinesFromSource(sym, interval as any, limit);
    for (const raw of klines) {
      const k = normalizeKlineRow(sym, interval, raw);
      if (!k) continue;
      await db.query(
        `select market.sp_ingest_kline_row($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        buildMarketKlineParams(k, sourceTag),
      );
      rows++;
    }
  }
  return rows;
}
