// src/core/system/refresh.ts
import { fetchCoinUniverseEntries, fetchPairUniverseCoins } from "@/lib/settings/coin-universe";
import { ingestTickerSymbols, ingestKlinesSymbols } from "./tasks";
import { query } from "@/core/db/db_server";
import { liveFromDbTickers } from "@/core/features/matrices/liveFromDb";
import { liveFromSources } from "@/core/features/matrices/liveFromSources";
import {
  configureBenchmarkProviders,
  computeFromDbAndLive,
} from "@/core/maths/math";
import {
  stageMatrixGrid,
  commitMatrixGrid,
  getPrevValue,
  persistLiveMatricesSlice,
} from "@/core/db/db";
import type { MatrixGridObject, MatrixType } from "@/core/db/db";
import { fetchOpeningGridFromView } from "@/core/features/matrices/opening";
import { fetchSnapshotBenchmarkGrid } from "@/core/features/matrices/snapshot";
import { fetchTradeBenchmarkGrid } from "@/core/features/matrices/trade";
import { getAppSessionId } from "@/core/system/appSession";

export type RefreshStepResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
};

export type SystemRefreshResult = {
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  symbols: string[];
  steps: RefreshStepResult[];
};

type RefreshOptions = {
  symbols?: string[];
  klinesInterval?: string;
  recordTelemetry?: boolean;
  pollerId?: string;
  window?: string;
  appSessionId?: string | null;
};

const KNOWN_QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "USD", "BTC", "ETH", "BNB"] as const;
const REFRESH_WINDOW = process.env.MATRICES_REFRESH_WINDOW ?? "1h";

export async function runSystemRefresh(opts: RefreshOptions = {}): Promise<SystemRefreshResult> {
  const appSessionId = opts.appSessionId ?? getAppSessionId();
  const universeEntries = opts.symbols
    ? opts.symbols.map((sym) => {
        const { base, quote } = splitSymbol(sym);
        return { symbol: sym.toUpperCase(), base, quote };
      })
    : await fetchCoinUniverseEntries({ onlyEnabled: true });

  const symbolList = universeEntries.map((entry) => entry.symbol.toUpperCase());
  const pairUniverseCoins = await fetchPairUniverseCoins();

  if (!symbolList.length) {
    throw new Error("coin universe is empty");
  }

  const startedAt = Date.now();
  const steps: RefreshStepResult[] = [];

  const runStep = async <T>(
    name: string,
    fn: () => Promise<T>,
    mapDetails?: (value: T) => Record<string, unknown>
  ) => {
    const t0 = Date.now();
    try {
      const value = await fn();
      const durationMs = Date.now() - t0;
      steps.push({
        name,
        ok: true,
        durationMs,
        details: mapDetails ? mapDetails(value) : undefined,
      });
    } catch (err: any) {
      const durationMs = Date.now() - t0;
      steps.push({
        name,
        ok: false,
        durationMs,
        error: String(err?.message ?? err),
      });
    }
  };

  await runStep("ticker", () => ingestTickerSymbols(symbolList), (count) => ({ wrote: count as number }));

  const klinesInterval = opts.klinesInterval ?? "1m";
  await runStep(
    `klines:${klinesInterval}`,
    () => ingestKlinesSymbols(symbolList, klinesInterval, 200),
    (count) => ({ wrote: count as number })
  );

  await runStep("matrices:persist", async () => {
    const fallbackCoins = dedupeCoins([
      ...universeEntries
        .map((entry) => entry.base || splitSymbol(entry.symbol).base)
        .filter(Boolean),
      "USDT",
    ]);
    const coins = pairUniverseCoins.length
      ? dedupeCoins([...pairUniverseCoins, ...fallbackCoins])
      : [...fallbackCoins];

    // Build matrices from DB tickers; fall back to live sources if DB is empty.
    let liveSource = "db:ticker_latest";
    let live = await liveFromDbTickers(coins).catch((err) => {
      console.warn("[system/refresh] liveFromDbTickers failed, fallback to sources:", err);
      return null;
    });
    if (!live || !live.coins.length) {
      liveSource = "api:liveFromSources";
      live = await liveFromSources(coins);
      // Warm ticker_latest for next ticks (best-effort).
      void ingestTickerSymbols(
        coins
          .map((c) => `${c}USDT`)
          .filter((sym) => sym && sym !== "USDTUSDT")
      ).catch(() => {});
    }

    const liveCoins = [...(live?.coins ?? [])];
    if (!liveCoins.length) {
      throw new Error("no live matrices available (db + api fallback failed)");
    }

    const tsMs = live.matrices.benchmark.ts;
    const openingMark = await persistLiveMatricesSlice({
      appSessionId,
      coins: liveCoins,
      tsMs,
      benchmark: live.matrices.benchmark.values,
      pct24h: live.matrices.pct24h.values,
      idemPrefix: `refresh:${opts.pollerId ?? "default"}:${liveSource}`,
    });

    let snapshotTs: number | null = null;
    let tradeTs: number | null = null;

    configureBenchmarkProviders({
      getPrev: (matrixType, base, quote, beforeTs) =>
        getPrevValue(matrixType, base.toUpperCase(), quote.toUpperCase(), beforeTs, appSessionId),
      fetchOpeningGrid: (coinsUniverse, nowTsParam) =>
        fetchOpeningGridFromView({
          coins: coinsUniverse,
          appSessionId,
          window: opts.window ?? REFRESH_WINDOW,
          openingTs: undefined,
        }),
      fetchSnapshotGrid: async (coinsUniverse, nowTsParam) => {
        const snap = await fetchSnapshotBenchmarkGrid(coinsUniverse);
        snapshotTs = snap.ts ?? null;
        return { ts: snap.ts ?? nowTsParam, grid: snap.grid };
      },
      fetchTradeGrid: async (coinsUniverse, nowTsParam) => {
        const trade = await fetchTradeBenchmarkGrid(coinsUniverse, appSessionId);
        tradeTs = trade.ts ?? null;
        return { ts: trade.ts ?? nowTsParam, grid: trade.grid };
      },
    });

    const derived = await computeFromDbAndLive({
      coins: liveCoins,
      nowTs: tsMs,
      liveBenchmark: valuesToGrid(liveCoins, live.matrices.benchmark.values),
    });

    await persistDerivedGrid({
      appSessionId,
      matrixType: "pct_drv",
      tsMs,
      coins: liveCoins,
      grid: derived.pct_drv,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "pct_ref",
      tsMs,
      coins: liveCoins,
      grid: derived.pct_ref,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "ref",
      tsMs,
      coins: liveCoins,
      grid: derived.ref,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "delta",
      tsMs,
      coins: liveCoins,
      grid: derived.delta,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "pct_snap",
      tsMs,
      coins: liveCoins,
      grid: derived.pct_snap,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
      snapshotStamp: snapshotTs != null,
      snapshotTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "snap",
      tsMs,
      coins: liveCoins,
      grid: derived.snap,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
      snapshotStamp: snapshotTs != null,
      snapshotTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "pct_traded",
      tsMs,
      coins: liveCoins,
      grid: derived.pct_traded,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
      tradeStamp: tradeTs != null,
      tradeTs,
    });
    await persistDerivedGrid({
      appSessionId,
      matrixType: "traded",
      tsMs,
      coins: liveCoins,
      grid: derived.traded,
      meta: { source: "derived@refresh" },
      openingStamp: openingMark.openingStamp,
      openingTs: openingMark.openingTs,
      tradeStamp: tradeTs != null,
      tradeTs,
    });

    return { coins: liveCoins.length, ts: tsMs };
  });

  const ok = steps.every((s) => s.ok);
  const finishedAt = Date.now();

  if (opts.recordTelemetry !== false) {
    await recordTelemetry({
      pollerId: opts.pollerId ?? "default",
      ok,
      durationMs: finishedAt - startedAt,
      error: ok ? null : steps.find((s) => !s.ok)?.error ?? null,
    });
  }

  return {
    ok,
    startedAt,
    finishedAt,
    symbols: symbolList,
    steps,
  };
}

function splitSymbol(symbol: string): { base: string; quote: string } {
  const upper = String(symbol || "").toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return { base: upper, quote: "USDT" };
}

function dedupeCoins(list: string[]): string[] {
  const set = new Set<string>();
  for (const entry of list) {
    const coin = String(entry || "").toUpperCase().trim();
    if (!coin) continue;
    set.add(coin);
  }
  return Array.from(set);
}

function valuesToGrid(coins: string[], values: Record<string, Record<string, number | null>>): (number | null)[][] {
  const grid: (number | null)[][] = Array.from({ length: coins.length }, () =>
    Array.from({ length: coins.length }, () => null)
  );
  for (let i = 0; i < coins.length; i++) {
    const bi = coins[i]!;
    const row = values[bi] || {};
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      const v = row[qj];
      grid[i][j] = v == null ? null : Number(v);
    }
  }
  return grid;
}

function gridToValues(coins: string[], grid: (number | null)[][]): MatrixGridObject {
  const out: MatrixGridObject = {};
  for (let i = 0; i < coins.length; i++) {
    const bi = coins[i]!;
    out[bi] = {} as Record<string, number | null>;
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      out[bi][qj] = grid[i][j] ?? null;
    }
  }
  return out;
}

async function persistDerivedGrid(opts: {
  appSessionId: string;
  matrixType: MatrixType;
  tsMs: number;
  coins: string[];
  grid: (number | null)[][];
  meta?: any;
  openingStamp?: boolean;
  openingTs?: number;
  snapshotStamp?: boolean;
  snapshotTs?: number | null;
  tradeStamp?: boolean;
  tradeTs?: number | null;
}) {
  const values = gridToValues(opts.coins, opts.grid);
  await stageMatrixGrid({
    appSessionId: opts.appSessionId,
    matrixType: opts.matrixType,
    tsMs: opts.tsMs,
    coins: opts.coins,
    values,
    meta: opts.meta,
    openingStamp: opts.openingStamp,
    openingTs: opts.openingTs,
    snapshotStamp: opts.snapshotStamp,
    snapshotTs: opts.snapshotTs ?? undefined,
    tradeStamp: opts.tradeStamp,
    tradeTs: opts.tradeTs ?? undefined,
  });
  await commitMatrixGrid({
    appSessionId: opts.appSessionId,
    matrixType: opts.matrixType,
    tsMs: opts.tsMs,
    coins: opts.coins,
    idem: `refresh:${opts.matrixType}:${opts.tsMs}`,
  });
}

async function recordTelemetry(input: {
  pollerId: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
}) {
  try {
    await query(
      `
        insert into settings.poller_state(poller_id, last_run_at, last_status, last_error, duration_ms, updated_at)
        values ($1, now(), $2, $3, $4, now())
        on conflict (poller_id) do update
          set last_run_at = excluded.last_run_at,
              last_status = excluded.last_status,
              last_error = excluded.last_error,
              duration_ms = excluded.duration_ms,
              updated_at = excluded.updated_at
      `,
      [input.pollerId, input.ok ? "ok" : "error", input.error, input.durationMs]
    );
  } catch (err) {
    console.warn("[system] unable to persist poller_state:", err);
  }
}
