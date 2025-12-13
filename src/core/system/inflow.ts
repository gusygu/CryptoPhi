// src/core/system/inflow.ts
// Shared inflow helpers to sanitize raw source payloads before DB upserts.

export type NormalizedKlineRow = {
  symbol: string;
  interval: string;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number | null;
  trades: number | null;
  takerBuyBase: number | null;
  takerBuyQuote: number | null;
};

const toNum = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const toOptNum = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Map a raw Binance kline array into a typed row or drop it if malformed. */
export function normalizeKlineRow(
  symbol: string,
  interval: string,
  raw: any[],
): NormalizedKlineRow | null {
  if (!Array.isArray(raw) || raw.length < 11) return null;

  const [
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime,
    quoteVolume,
    trades,
    takerBuyBase,
    takerBuyQuote,
  ] = raw;

  const openMs = Number(openTime);
  const closeMs = Number(closeTime);
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) return null;

  const openNum = toNum(open);
  const highNum = toNum(high);
  const lowNum = toNum(low);
  const closeNum = toNum(close);
  const volumeNum = toNum(volume);
  if ([openNum, highNum, lowNum, closeNum, volumeNum].some((v) => !Number.isFinite(v))) {
    return null;
  }

  const normalizedInterval = interval.toLowerCase();
  const normalizedSymbol = symbol.toUpperCase();

  return {
    symbol: normalizedSymbol,
    interval: normalizedInterval,
    openTime: new Date(openMs),
    closeTime: new Date(closeMs),
    open: openNum,
    high: highNum,
    low: lowNum,
    close: closeNum,
    volume: volumeNum,
    quoteVolume: toOptNum(quoteVolume),
    trades: Number.isFinite(Number(trades)) ? Number(trades) : null,
    takerBuyBase: toOptNum(takerBuyBase),
    takerBuyQuote: toOptNum(takerBuyQuote),
  };
}

/** Build the argument list expected by market.sp_ingest_kline_row. */
export function buildMarketKlineParams(
  row: NormalizedKlineRow,
  source = "inflow",
): (string | number | Date | null)[] {
  return [
    row.symbol,
    row.interval,
    row.openTime,
    row.closeTime,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    row.quoteVolume,
    row.trades,
    row.takerBuyBase,
    row.takerBuyQuote,
    source,
  ];
}
