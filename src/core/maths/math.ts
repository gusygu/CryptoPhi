// math.ts - core grid math for Matrices (DB + Live fusion)
// Uses providers injected by route.ts (incl. opening.ts) to compute:
//  id_pct, pct_drv, pct_ref, ref, delta

export type Num = number | null;

/** Simple typed newGrid helper. */
export function newGrid<T>(n: number, fill: T): T[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => fill));
}

type ProviderGetPrev = (
  matrix_type: "benchmark" | "id_pct",
  base: string,
  quote: string,
  beforeTs: number
) => Promise<number | null>;

/**
 * Opening grid provider (wired to opening.ts by the API route).
 * Returns an NxN grid of opening benchmark values for the same coin universe.
 */
type ProviderOpeningGrid = (
  coins: string[],
  nowTs: number
) => Promise<{ ts: number; grid: (number | null)[][] }>;

/**
 * Snapshot grid provider (wired to snapshot helper by callers).
 * Returns an NxN grid of benchmark values captured at the latest snapshot stamp.
 */
type ProviderSnapshotGrid = (
  coins: string[],
  nowTs: number
) => Promise<{ ts: number | null; grid: (number | null)[][] }>;

type ProviderTradeGrid = (
  coins: string[],
  nowTs: number
) => Promise<{ ts: number | null; grid: (number | null)[][] }>;

type Providers = {
  getPrev: ProviderGetPrev;
  fetchOpeningGrid: ProviderOpeningGrid;
  fetchSnapshotGrid?: ProviderSnapshotGrid;
  fetchTradeGrid?: ProviderTradeGrid;
};

let PROV: Providers | null = null;

/** Called by route.ts to inject DB providers (no global imports here). */
export function configureBenchmarkProviders(p: Providers) {
  PROV = p;
}

const safeDiv = (num: number | null, den: number | null): number | null => {
  if (num == null || den == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 1e-300) return null;
  return num / den;
};

/** Reference block (pct_ref + ref) */
export function computeRefBlock(args: {
  benchmarkNew: number | null;  // latest bm
  id_pct: number | null;        // decimal, e.g. 0.0123 (latest)
  refValue: number | null;      // opening bm
}): { pct_ref: number | null; ref: number | null } {
  const { benchmarkNew, id_pct, refValue } = args;

  // pct_ref = (bm_open - bm_new)/bm_open  (opening vs latest)
  const pct_ref =
    refValue == null || benchmarkNew == null
      ? null
      : safeDiv(refValue - benchmarkNew, refValue);

  // ref = pct_ref * id_pct (both latest)
  const ref = pct_ref == null || id_pct == null ? null : pct_ref * id_pct;

  return { pct_ref, ref };
}

export type ComputeInput = {
  coins: string[];                    // uppercase universe (includes USDT)
  nowTs: number;                      // timestamp for "prev" lookups
  liveBenchmark: (number | null)[][]; // NxN live bm grid (from liveFromSources.ts)
};

export type ComputeOutput = {
  id_pct: (number | null)[][];
  pct_drv: (number | null)[][];
  pct_ref: (number | null)[][];
  ref: (number | null)[][];
  delta: (number | null)[][];
  pct_snap: (number | null)[][];
  snap: (number | null)[][];
  pct_traded: (number | null)[][];
  traded: (number | null)[][];
};

/**
 * Main derivation using:
 *  - live benchmark grid (now)
 *  - prev(benchmark) and prev(id_pct) from DB
 *  - opening(first-of-day/session) reference grid from DB (via opening.ts)
 *
 * Formulas:
 *  id_pct   = (bm_new - bm_prev)/bm_prev
 *  pct_drv  = id_pct_new - id_pct_old
 *  pct_ref  = (bm_open - bm_new)/bm_open
 *  ref      = pct_ref * id_pct
 *  delta    = bm_new - bm_open * (1 + ref)
 *  pct_snap = (bm_snap - bm_new)/bm_snap
 *  snap     = pct_snap * (1 + id_pct)
 *  pct_traded = (bm_trade - bm_new)/bm_trade
 *  traded     = pct_traded * (1 + id_pct)
 */
export async function computeFromDbAndLive(input: ComputeInput): Promise<ComputeOutput> {
  if (!PROV) throw new Error("Providers not configured. Call configureBenchmarkProviders(...) first.");

  const { coins, nowTs, liveBenchmark } = input;
  const n = coins.length;

  const id_pct = newGrid<Num>(n, null);
  const pct_drv = newGrid<Num>(n, null);
  const pct_ref = newGrid<Num>(n, null);
  const ref = newGrid<Num>(n, null);
  const delta = newGrid<Num>(n, null);
  const pct_snap = newGrid<Num>(n, null);
  const snap = newGrid<Num>(n, null);
  const pct_traded = newGrid<Num>(n, null);
  const traded = newGrid<Num>(n, null);

  // 1) Opening grid (persisted opening from v_dyn_matrices via opening.ts)
  const opening = await PROV.fetchOpeningGrid(coins, nowTs);
  const openGrid = opening.grid;

  const snapshot = PROV.fetchSnapshotGrid ? await PROV.fetchSnapshotGrid(coins, nowTs) : null;
  const snapGrid = snapshot?.grid;
  const trade = PROV.fetchTradeGrid ? await PROV.fetchTradeGrid(coins, nowTs) : null;
  const tradeGrid = trade?.grid;

  // 2) prev(benchmark) and prev(id_pct) per pair
  for (let i = 0; i < n; i++) {
    const bi = coins[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const qj = coins[j]!;

      const bmNow = liveBenchmark[i][j];

      // id_pct = (bm_new - bm_prev)/bm_prev
      const bmPrev = await PROV.getPrev("benchmark", bi, qj, nowTs);
      const idNow = (bmPrev == null)
        ? null
        : safeDiv((bmNow == null ? null : bmNow - bmPrev), bmPrev);
      id_pct[i][j] = idNow;

      // pct_drv = id_pct_new - id_pct_old
      const prevId = await PROV.getPrev("id_pct", bi, qj, nowTs);
      pct_drv[i][j] =
        (idNow == null || prevId == null || !Number.isFinite(prevId))
          ? null
          : (idNow - Number(prevId));

      // pct_ref/ref with persisted opening
      const openVal = openGrid[i][j];
      const { pct_ref: pr, ref: r } = computeRefBlock({
        benchmarkNew: bmNow,
        id_pct: idNow,
        refValue: openVal
      });
      pct_ref[i][j] = pr;
      ref[i][j] = r;

      // delta = bm_new - bm_open * (1 + ref)
      delta[i][j] =
        (bmNow == null || openVal == null || r == null)
          ? null
          : (bmNow - openVal * (1 + r));

      const snapVal = snapGrid?.[i]?.[j] ?? null;
      const pctSnap =
        snapVal == null || bmNow == null
          ? null
          : safeDiv(snapVal - bmNow, snapVal);
      pct_snap[i][j] = pctSnap;
      snap[i][j] =
        pctSnap == null || idNow == null
          ? null
          : ((1 + idNow) * pctSnap);

      const tradeVal = tradeGrid?.[i]?.[j] ?? null;
      const pctTraded =
        tradeVal == null || bmNow == null
          ? null
          : safeDiv(tradeVal - bmNow, tradeVal);
      pct_traded[i][j] = pctTraded;
      traded[i][j] =
        pctTraded == null || idNow == null
          ? null
          : ((1 + idNow) * pctTraded);
    }
  }

  return { id_pct, pct_drv, pct_ref, ref, delta, pct_snap, snap, pct_traded, traded };
}

