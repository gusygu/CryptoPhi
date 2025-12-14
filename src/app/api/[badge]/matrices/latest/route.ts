// app/api/matrices/latest/route.ts

import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import {
  getPrevSnapshotByType,
  getPrevValue,
} from "@/core/db/db";
import { liveFromSources } from "@/core/features/matrices/liveFromSources";
import {
  configureBenchmarkProviders,
  computeFromDbAndLive,
} from "@/core/maths/math";
import { fetchOpeningGridFromView } from "@/core/features/matrices/opening";
import { fetchSnapshotBenchmarkGrid } from "@/core/features/matrices/snapshot";
import { fetchTradeBenchmarkGrid } from "@/core/features/matrices/trade";
import { resolveCoinsFromSettings } from "@/lib/settings/server";
import { fetchPairUniverseCoins } from "@/lib/settings/coin-universe";
// typed downstream import from matrices frozen helpers (no runtime impact)
import type {
  FrozenPairKey,
  buildFrozenSetFromFlags,
  materializeFrozenGridFromSet,
  isPairFrozenFromSet,
  getFrozenSetFromMatricesLatest,
} from "@/core/features/matrices/matrices";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { getPool, type PoolClient } from "@/core/db/pool_server";
// keep these aliases so TS treats the imports as “used” (still type-only)
type _FrozenPairKey = FrozenPairKey;
type _FrozenSetBuilder = typeof buildFrozenSetFromFlags;
type _FrozenGridMaterializer = typeof materializeFrozenGridFromSet;
type _IsPairFrozen = typeof isPairFrozenFromSet;
type _GetFrozenSetLatest = typeof getFrozenSetFromMatricesLatest;

const ALLOWED_WINDOWS = new Set(["15m", "30m", "1h"] as const);
type MatrixWindow = "15m" | "30m" | "1h";

const normalizeCoins = (xs: readonly string[]) =>
  Array.from(new Set(xs.map((s) => s.trim().toUpperCase()).filter(Boolean)));

function parseCoinsCSV(csv: string | null | undefined): string[] | null {
  if (!csv) return null;
  return normalizeCoins(csv.split(","));
}

function parseCoinsJSON(jsonStr: string | null | undefined): string[] | null {
  if (!jsonStr) return null;
  try {
    const xs = JSON.parse(jsonStr);
    if (!Array.isArray(xs)) return null;
    return normalizeCoins(xs);
  } catch {
    return null;
  }
}

function coinsAddUSDTFirst(userCoins: readonly string[]) {
  const xs = normalizeCoins(userCoins);
  const withoutUSDT = xs.filter((c) => c !== "USDT");
  return ["USDT", ...withoutUSDT];
}

async function coinsFromCookiesOrHeaders(): Promise<string[] | null> {
  const bagCookies = cookies();
  const bagHeaders = headers();

  const ckJson = (await bagCookies).get("cp_coins")?.value; // JSON array
  const ckCsv = (await bagCookies).get("cp.coins")?.value; // CSV
  const fromCkJson = parseCoinsJSON(ckJson);
  const fromCkCsv = parseCoinsCSV(ckCsv);
  if (fromCkJson?.length) return fromCkJson;
  if (fromCkCsv?.length) return fromCkCsv;

  const hxCsv = (await bagHeaders).get("x-cp-coins");
  const hxJson = (await bagHeaders).get("x-cp-coins-json");
  const fromHxCsv = parseCoinsCSV(hxCsv ?? undefined);
  const fromHxJson = parseCoinsJSON(hxJson ?? undefined);
  if (fromHxJson?.length) return fromHxJson;
  if (fromHxCsv?.length) return fromHxCsv;

  return null;
}

async function resolveCoinsUniverse(
  preferred: string[] | null,
  ctx: { userId: string; badge: string },
  allowedCoins: string[],
): Promise<string[]> {
  const allowedUniverse = coinsAddUSDTFirst(allowedCoins);

  if (preferred && preferred.length) {
    const preferredSet = new Set(normalizeCoins(preferred));
    const filtered = allowedUniverse.filter((coin) => preferredSet.has(coin));
    if (filtered.length) return coinsAddUSDTFirst(filtered);
  }

  if (allowedUniverse.length) return allowedUniverse;

  const legacy = await coinsFromCookiesOrHeaders();
  if (legacy?.length) return coinsAddUSDTFirst(legacy);

  return ["USDT"];
}

function ensureWindow(win: string | null | undefined): MatrixWindow {
  if (!win) return "30m";
  const lc = win.toLowerCase();
  return ALLOWED_WINDOWS.has(lc as MatrixWindow)
    ? (lc as MatrixWindow)
    : "30m";
}

type MatValues = Record<string, Record<string, number | null>>;
const LIVE_TIMEOUT_MS = Number(process.env.MATRICES_LIVE_TIMEOUT_MS ?? 4_000);
const LIVE_ENABLED = process.env.MATRICES_LIVE_DISABLED !== "true";

type MatricesLatestSuccessPayload = {
  ok: true;
  coins: string[];
  symbols: string[];
  quote: string;
  window: MatrixWindow;
  ts: number;
  matrices: {
    benchmark: { ts: number; values: MatValues; flags?: any };
    pct24h: { ts: number; values: MatValues; flags?: any };
    id_pct: { ts: number; values: MatValues };
    pct_drv: { ts: number; values: MatValues };
    pct_ref: { ts: number; values: MatValues };
    ref: { ts: number; values: MatValues };
    delta: { ts: number; values: MatValues };
    pct_snap: { ts: number; values: MatValues };
    snap: { ts: number; values: MatValues };
    pct_traded: { ts: number; values: MatValues };
    traded: { ts: number; values: MatValues };
  };
  meta: {
    openingTs: number | null;
    snapshotTs: number | null;
    tradeTs: number | null;
    universe: string[];
  };
};

type MatricesLatestErrorPayload = {
  ok: false;
  error: string;
};

export type MatricesLatestPayload =
  | MatricesLatestSuccessPayload
  | MatricesLatestErrorPayload;

export const dynamic = "force-dynamic";
export const revalidate = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function emptyMatricesPayload(args: {
  coins: string[];
  quote: string;
  window: MatrixWindow;
}): MatricesLatestSuccessPayload {
  const now = Date.now();
  const values: MatValues = {};
  const coins = normalizeCoins(args.coins);
  const coinsDisplay = coins.filter((c) => c !== args.quote);
  return {
    ok: true,
    coins: coinsDisplay,
    symbols: [],
    quote: args.quote,
    window: args.window,
    ts: now,
    matrices: {
      benchmark: { ts: now, values },
      pct24h: { ts: now, values },
      id_pct: { ts: now, values },
      pct_drv: { ts: now, values },
      pct_ref: { ts: now, values },
      ref: { ts: now, values },
      delta: { ts: now, values },
      pct_snap: { ts: now, values },
      snap: { ts: now, values },
      pct_traded: { ts: now, values },
      traded: { ts: now, values },
    },
    meta: { openingTs: null, snapshotTs: null, tradeTs: null, universe: coins },
  };
}

function toGrid(
  coins: readonly string[],
  values: MatValues
): (number | null)[][] {
  const n = coins.length;
  const grid: (number | null)[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => null)
  );
  for (let i = 0; i < n; i++) {
    const bi = coins[i]!;
    const row = values[bi] || {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      const v = row[qj];
      grid[i][j] = v == null ? null : Number(v);
    }
  }
  return grid;
}

function toValues(
  coins: readonly string[],
  grid: (number | null)[][]
): MatValues {
  const out: MatValues = {};
  for (let i = 0; i < coins.length; i++) {
    const bi = coins[i]!;
    out[bi] = {} as any;
    for (let j = 0; j < coins.length; j++) {
      if (i === j) continue;
      const qj = coins[j]!;
      out[bi][qj] = grid[i][j] ?? null;
    }
  }
  return out;
}

async function parseQuery(req: Request, badgeHint?: string | null): Promise<{
  coins: string[] | null;
  quote: string;
  window: MatrixWindow;
  appSessionId: string | null;
}> {
  const url = new URL(req.url);
  const qCoins = parseCoinsCSV(url.searchParams.get("coins"));
  const quote = (url.searchParams.get("quote") || "USDT").toUpperCase();
  const window = ensureWindow(url.searchParams.get("window"));
  const appSessionId = (badgeHint || "").trim() || null;
  return { coins: qCoins, quote, window, appSessionId };
}

type BuildMatricesLatestArgs = {
  coins?: string[] | null;
  quote?: string;
  window?: string | null;
  appSessionId?: string | null;
  allowedCoins?: string[];
};

const pickValues = (coins: readonly string[], vals: MatValues): MatValues => {
  const toKeep = coins;
  const out: MatValues = {};
  for (const b of toKeep) {
    const row = vals[b] || {};
    const dst: Record<string, number | null> = {};
    for (const q of toKeep) {
      if (b === q) continue;
      if (Object.prototype.hasOwnProperty.call(row, q)) {
        dst[q] = row[q]!;
      }
    }
    out[b] = dst;
  }
  return out;
};

export async function buildMatricesLatestPayload(
  params: BuildMatricesLatestArgs & { userId: string; badge: string; resolvedFromSessionMap?: boolean; client: PoolClient }
): Promise<MatricesLatestPayload> {
  const quote = (params.quote ?? "USDT").toUpperCase();
  const window = ensureWindow(params.window ?? null);
  const appSessionId = params.appSessionId ?? params.badge ?? null;

  try {
    const queryCoinsNormalized = Array.isArray(params.coins)
      ? normalizeCoins(params.coins)
      : null;

    const preferCoins =
      queryCoinsNormalized && queryCoinsNormalized.length
        ? queryCoinsNormalized
        : null;
    const allowedCoins = Array.isArray(params.allowedCoins) ? normalizeCoins(params.allowedCoins) : [];
    const resolvedCoins = await resolveCoinsUniverse(preferCoins, { userId: params.userId, badge: params.badge }, allowedCoins);
    const requestedCoins = normalizeCoins(resolvedCoins);

    if (!requestedCoins.length) {
      throw new Error("No coins resolved for matrices universe");
    }

    if (!LIVE_ENABLED) {
      return emptyMatricesPayload({ coins: requestedCoins, quote, window });
    }

    const live = await withTimeout(
      liveFromSources(requestedCoins),
      LIVE_TIMEOUT_MS,
      "liveFromSources"
    ).catch((err) => {
      console.warn("[matrices/latest] liveFromSources failed:", err);
      return null;
    });

    if (!live) {
      return emptyMatricesPayload({ coins: requestedCoins, quote, window });
    }

    const coins = normalizeCoins(live.coins.length ? live.coins : requestedCoins);

    const bmGrid = toGrid(coins, live.matrices.benchmark.values);
    const nowTs = live.matrices.benchmark.ts;

    const [prevBenchmarkRows, prevIdPctRows] = await Promise.all([
      getPrevSnapshotByType("benchmark", nowTs, coins, appSessionId, params.client),
      getPrevSnapshotByType("id_pct", nowTs, coins, appSessionId, params.client),
    ]);

    const prevBenchmarkMap = new Map<string, number>();
    for (const row of prevBenchmarkRows) {
      const key = `${row.base.toUpperCase()}/${row.quote.toUpperCase()}`;
      const value = Number(row.value);
      if (Number.isFinite(value)) prevBenchmarkMap.set(key, value);
    }

    const prevIdPctMap = new Map<string, number>();
    for (const row of prevIdPctRows) {
      const key = `${row.base.toUpperCase()}/${row.quote.toUpperCase()}`;
      const value = Number(row.value);
      if (Number.isFinite(value)) prevIdPctMap.set(key, value);
    }

    let lastOpeningTs: number | null = null;
    let lastSnapshotTs: number | null = null;
    let lastTradeTs: number | null = null;

    configureBenchmarkProviders({
      getPrev: async (matrix_type, base, quoteSym, beforeTs) => {
        const key = `${base.toUpperCase()}/${quoteSym.toUpperCase()}`;
        const fromPrefetch =
          matrix_type === "benchmark"
            ? prevBenchmarkMap.get(key)
            : matrix_type === "id_pct"
            ? prevIdPctMap.get(key)
            : undefined;
        if (fromPrefetch != null) return fromPrefetch;
        return getPrevValue(
          matrix_type,
          base.toUpperCase(),
          quoteSym.toUpperCase(),
          beforeTs,
          appSessionId,
          params.client
        );
      },

      fetchOpeningGrid: async (coinsUniverse, nowTsParam) => {
        const ref = await fetchOpeningGridFromView({
          coins: coinsUniverse,
          window,
          appSessionId,
          openingTs: undefined,
          client: params.client,
        });
        lastOpeningTs = ref.ts ?? nowTsParam;
        return { ts: ref.ts ?? nowTsParam, grid: ref.grid };
      },

      fetchSnapshotGrid: async (coinsUniverse, nowTsParam) => {
        const snap = await fetchSnapshotBenchmarkGrid(coinsUniverse, appSessionId, params.client);
        lastSnapshotTs = snap.ts ?? null;
        return { ts: snap.ts ?? nowTsParam, grid: snap.grid };
      },
      fetchTradeGrid: async (coinsUniverse, nowTsParam) => {
        const trade = await fetchTradeBenchmarkGrid(coinsUniverse, appSessionId, params.client);
        lastTradeTs = trade.ts ?? null;
        return { ts: trade.ts ?? nowTsParam, grid: trade.grid };
      },
    });

    const derived = await computeFromDbAndLive({
      coins: coins.slice(),
      nowTs,
      liveBenchmark: bmGrid,
    });

    const bmValues = pickValues(coins, live.matrices.benchmark.values);
    const pct24Values = pickValues(coins, live.matrices.pct24h.values);
    const idPctValues = toValues(coins, derived.id_pct);
    const drvValues = toValues(coins, derived.pct_drv);
    const pctRefValues = toValues(coins, derived.pct_ref);
    const refValues = toValues(coins, derived.ref);
    const deltaValues = toValues(coins, derived.delta);
    const pctSnapValues = toValues(coins, derived.pct_snap);
    const snapValues = toValues(coins, derived.snap);
    const pctTradedValues = toValues(coins, derived.pct_traded);
    const tradedValues = toValues(coins, derived.traded);

    const symbols: string[] = [];
    for (let i = 0; i < coins.length; i++) {
      for (let j = 0; j < coins.length; j++) {
        if (i === j) continue;
        symbols.push(`${coins[i]}${coins[j]}`);
      }
    }

    const coinsDisplay = coins.filter((c) => c !== quote);

    return {
      ok: true,
      coins: coinsDisplay,
      symbols,
      quote,
      window,
      ts: nowTs,
      matrices: {
        benchmark: {
          ts: nowTs,
          values: bmValues,
          flags: live.matrices.benchmark.flags,
        },
        pct24h: {
          ts: nowTs,
          values: pct24Values,
          flags: live.matrices.pct24h.flags,
        },
        id_pct: { ts: nowTs, values: idPctValues },
        pct_drv: { ts: nowTs, values: drvValues },
        pct_ref: { ts: nowTs, values: pctRefValues },
        ref: { ts: nowTs, values: refValues },
        delta: { ts: nowTs, values: deltaValues },
        pct_snap: { ts: lastSnapshotTs ?? nowTs, values: pctSnapValues },
        snap: { ts: lastSnapshotTs ?? nowTs, values: snapValues },
        pct_traded: { ts: lastTradeTs ?? nowTs, values: pctTradedValues },
        traded: { ts: lastTradeTs ?? nowTs, values: tradedValues },
      },
      meta: {
        openingTs: lastOpeningTs,
        snapshotTs: lastSnapshotTs,
        tradeTs: lastTradeTs,
        universe: coins,
      },
    } satisfies MatricesLatestSuccessPayload;
  } catch (err: any) {
    console.error("[matrices/latest] error:", err);
    return {
      ok: false,
      error: String(err?.message ?? err),
    } satisfies MatricesLatestErrorPayload;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: { badge: string } },
) {
  let client: PoolClient | null = null;
  let badge: string | null = null;
  let userId: string | null = null;
  let resolvedFromSessionMap = false;
  try {
    const paramsMaybe = (context as any)?.params;
    const params =
      paramsMaybe && typeof paramsMaybe.then === "function" ? await paramsMaybe : paramsMaybe;
    const resolved = await resolveBadgeRequestContext(req, params);
    if (!resolved.ok) {
      return NextResponse.json(resolved.body, { status: resolved.status });
    }
    badge = resolved.badge;
    userId = resolved.session.userId;
    resolvedFromSessionMap = (resolved.session as any)?.resolvedFromSessionMap ?? false;
    if (!badge || !userId) {
      throw new Error("badge_or_user_missing");
    }

    client = await getPool().connect();
    await client.query("BEGIN");
    await client.query("select auth.set_request_context($1,$2,$3)", [userId, resolved.session.isAdmin ?? false, badge]);

    const allowedCoins = normalizeCoins(
      await resolveCoinsFromSettings({ userId, sessionId: badge, client }),
    );

    const q = await parseQuery(req, badge);
    const appSessionId = badge;
    q.appSessionId = appSessionId;

    const payload = await buildMatricesLatestPayload({
      ...q,
      userId,
      badge,
      allowedCoins,
      resolvedFromSessionMap,
      client,
    });

    await client.query("COMMIT");

    if (process.env.NODE_ENV !== "production") {
      console.info(
        JSON.stringify({
          tag: "matrices_latest_universe",
          userId,
          badge,
          resolvedFromSessionMap,
          coins: payload.ok ? payload.meta.universe : [],
          allowedCoins,
          coinsUsed: payload.ok ? payload.meta.universe : [],
        }),
      );
    }
    const status = payload.ok ? 200 : 500;
    const resHeaders = new Headers();
    if (userId) resHeaders.set("x-user-uuid", userId);
    if (badge) resHeaders.set("x-session-id", badge);
    if (payload.ok) {
      resHeaders.set("x-universe", payload.meta.universe.join(","));
    }
    resHeaders.set("Cache-Control", "no-store, max-age=0");
    const responseBody = {
      ...payload,
      resolved: { badge, userId, sessionId: badge },
      coinsUsed: payload.ok ? payload.meta.universe : [],
      resolvedFromSessionMap,
    };
    return NextResponse.json(responseBody, { status, headers: resHeaders });
  } catch (err: any) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    const resHeaders = new Headers();
    if (userId) resHeaders.set("x-user-uuid", userId);
    if (badge) resHeaders.set("x-session-id", badge);
    console.error("[matrices/latest] internal error:", err);
    resHeaders.set("Cache-Control", "no-store, max-age=0");
    return NextResponse.json(
      {
        ok: false,
        error: "internal_error",
        route: "matrices/latest",
        badge,
        userId,
        message: String(err?.message ?? err),
        resolved: { badge, userId, sessionId: badge },
        coinsUsed: [],
        resolvedFromSessionMap,
      },
      { status: 500, headers: resHeaders },
    );
  } finally {
    client?.release?.();
  }
}
