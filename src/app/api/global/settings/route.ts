import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/app/api/_lib/responses";
import { resolveCycleSeconds } from "@/core/settings/time";
import { fetchCoinUniverseBases, normalizeCoinList } from "@/lib/settings/coin-universe";
import { DEFAULT_SETTINGS, migrateSettings } from "@/lib/settings/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const settings = migrateSettings(DEFAULT_SETTINGS);

  try {
    const cycleSeconds = await resolveCycleSeconds("global");
    settings.timing.autoRefreshMs = Math.max(1_000, cycleSeconds * 1_000);
  } catch {
    /* best effort */
  }

  try {
    const coins = await fetchCoinUniverseBases({
      onlyEnabled: true,
      context: { userId: "system", sessionId: "global", isAdmin: true },
    });
    const normalized = normalizeCoinList(coins);
    if (normalized.length) {
      settings.coinUniverse = normalized;
    }
  } catch {
    /* keep defaults if lookup fails */
  }

  return NextResponse.json(
    { settings, coinUniverse: settings.coinUniverse, coins: settings.coinUniverse },
    { headers: noStoreHeaders() }
  );
}
