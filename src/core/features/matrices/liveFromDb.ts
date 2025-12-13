// Build live benchmark & pct24h matrices from DB tickers (market.ticker_latest/ticker_ticks).
import { query } from "@/core/db/db_server";

type MatValues = Record<string, Record<string, number | null>>;
type Mat = { ts: number; prevTs: number | null; values: MatValues; flags?: any };

const normCoins = (xs: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const u = String(x || "").toUpperCase().trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
};

const makeGrid = <T extends number | null>(coins: string[], fn: (b: string, q: string) => T): MatValues => {
  const out: MatValues = {};
  for (const b of coins) {
    out[b] = {} as any;
    for (const q of coins) {
      if (b === q) continue;
      out[b][q] = fn(b, q);
    }
  }
  return out;
};

type LatestRow = { symbol: string; price: number; ts_ms: number };

async function fetchLatestPrices(symbols: string[]): Promise<Record<string, LatestRow>> {
  if (!symbols.length) return {};
  const { rows } = await query<LatestRow>(
    `
    select symbol, price, extract(epoch from ts)*1000 as ts_ms
    from market.ticker_latest
    where symbol = any($1::text[])
  `,
    [symbols],
  );
  const map: Record<string, LatestRow> = {};
  for (const r of rows) map[r.symbol.toUpperCase()] = { ...r, price: Number(r.price), ts_ms: Number(r.ts_ms) };
  return map;
}

async function fetchOpen24h(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols.length) return {};
  const { rows } = await query<{ symbol: string; price: number }>(
    `
    with ranked as (
      select symbol, price,
             row_number() over (partition by symbol order by ts desc) as rn
      from market.ticker_ticks
      where symbol = any($1::text[])
        and ts <= now() - interval '24 hours'
    )
    select symbol, price from ranked where rn = 1
  `,
    [symbols],
  );
  const map: Record<string, number> = {};
  for (const r of rows) map[r.symbol.toUpperCase()] = Number(r.price);
  return map;
}

export async function liveFromDbTickers(requestedCoins: string[]) {
  const seed = normCoins(requestedCoins);
  const symbols = seed.filter((c) => c !== "USDT").map((c) => `${c}USDT`);
  const latest = await fetchLatestPrices(symbols);

  const price: Record<string, number> = { USDT: 1 };
  let tsMs = Date.now();

  for (const sym of symbols) {
    const entry = latest[sym.toUpperCase()];
    if (!entry || !Number.isFinite(entry.price)) continue;
    const coin = sym.slice(0, -4);
    price[coin] = Number(entry.price);
    if (entry.ts_ms && entry.ts_ms > tsMs) tsMs = entry.ts_ms;
  }

  // Drop coins without a usable price
  const coins = seed.filter((c) => c === "USDT" || price[c] != null);

  const openMap = await fetchOpen24h(symbols);
  const pct: Record<string, number | null> = { USDT: 0 };
  for (const sym of symbols) {
    const coin = sym.slice(0, -4);
    const pNow = price[coin];
    if (pNow == null) continue;
    const pOpen = openMap[sym.toUpperCase()];
    if (pOpen == null || !Number.isFinite(pOpen) || pOpen === 0) {
      pct[coin] = null;
      continue;
    }
    pct[coin] = (pNow - pOpen) / pOpen;
  }

  const benchmark: Mat = {
    ts: tsMs,
    prevTs: null,
    values: makeGrid(coins, (b, q) => {
      const pb = price[b] ?? (b === "USDT" ? 1 : NaN);
      const pq = price[q] ?? (q === "USDT" ? 1 : NaN);
      if (!Number.isFinite(pb) || !Number.isFinite(pq) || pq === 0) return null;
      return pb / pq;
    }),
    flags: { source: "db:ticker_latest" },
  };

  const pct24h: Mat = {
    ts: tsMs,
    prevTs: null,
    values: makeGrid(coins, (b, q) => {
      const rb = b === "USDT" ? 0 : pct[b] ?? null;
      const rq = q === "USDT" ? 0 : pct[q] ?? null;
      if (rb == null || rq == null) return null;
      const nb = 1 + rb;
      const nq = 1 + rq;
      if (!Number.isFinite(nb) || !Number.isFinite(nq) || nq === 0) return null;
      return nb / nq - 1;
    }),
    flags: { source: "db:ticker_ticks" },
  };

  return {
    ok: true,
    coins,
    matrices: { benchmark, pct24h },
  } as const;
}
