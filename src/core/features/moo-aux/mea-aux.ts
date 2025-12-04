// moo-aux.ts — orchestrator

import { computeMEA, type IdPctGrid, type CoverageGrid, type BalancesMap } from "@/lib/mea/mea";
import { type TierConfig, type MoodConfig } from "@/lib/mea/types";
import { computeMoodCoeffV1, moodUUIDFromBuckets, type MoodInputs } from "@/lib/mea/mood";
import { DEFAULT_TIER_RULES } from "./tiers";

export type SettingsAPI = {
  getCoinUniverse: () => Promise<string[]>;
};

export type MarketAPI = {
  getPairsSnapshot: (coins: string[]) => Promise<Array<{
    base: string; quote: string; id_pct: number | null; tradable: boolean;
  }>>;
};

export async function buildMeaFromSources(params: {
  settings: SettingsAPI;
  market: MarketAPI;
  balances: BalancesMap;
  // Provide mood inputs from your metrics assembler (or call another service)
  moodInputs: MoodInputs;
  idPctBaseline?: number;
}) {
  const { settings, market, balances, moodInputs, idPctBaseline = 1.0 } = params;

  const coins = await settings.getCoinUniverse();

  // shape grids
  const idPct: IdPctGrid = {};
  const coverage: CoverageGrid = {};
  for (const b of coins) { idPct[b] = {}; coverage[b] = {}; for (const q of coins) {
    idPct[b][q] = null; coverage[b][q] = false;
  }}

  const pairs = await market.getPairsSnapshot(coins);
  for (const p of pairs) {
    idPct[p.base][p.quote] = p.id_pct;
    coverage[p.base][p.quote] = !!p.tradable;
  }

  const { coeff: moodCoeff, buckets } = computeMoodCoeffV1(moodInputs);
  const moodUUID = moodUUIDFromBuckets(buckets);

  const tierConfig: TierConfig = {
    bands: DEFAULT_TIER_RULES.map((rule) => ({
      name: rule.name,
      zMin: rule.minAbs,
      zMax: rule.maxAbs ?? Number.POSITIVE_INFINITY,
      weight: rule.weight,
    })),
    eps: 1e-6,
  };

  const moodConfig: MoodConfig = {
    weakMax: 0.5,
    moderateMax: 1.0,
    defaultCoeff: 1.0,
    clampMin: 0.2,
    clampMax: 2.0,
  };

  const res = computeMEA({
    coins,
    balances,
    idPct,
    coverage,
    idPctBaseline,
    moodCoeff,
    config: {
      tiers: tierConfig,
      mood: moodConfig,
      matrixMode: "diagonal",
      perCoinCap: 3.0,
      clampMinAllocation: 0,
      clampMaxAllocation: Number.POSITIVE_INFINITY,
    },
  });

  return { ...res, coins, pairs, moodUUID };
}

