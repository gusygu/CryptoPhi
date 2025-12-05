// src/core/settings.ts
import { loadSettings as loadAppSettings } from "@/app/(server)/settings/gateway";
import type { PipelineSettings } from "@/core/pipelines/types";
import { resolveCycleSeconds } from "@/core/settings/time";

function toUpperList(list: Iterable<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const token = String(item ?? "").trim().toUpperCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export async function loadSettings(): Promise<PipelineSettings> {
  const appSettings = await loadAppSettings();
  const appSessionId = (appSettings as any)?.appSessionId ?? null;

  const quote = (appSettings.quote ?? "USDT").toUpperCase();
  const bases = toUpperList(appSettings.universe ?? []).filter((base) => base !== quote);
  if (!bases.length) bases.push("BTC", "ETH", "BNB");

  const cycleSeconds = await resolveCycleSeconds(appSessionId).catch(() => null);
  const cycleMs = Math.max(
    1_000,
    Number(appSettings.timing?.autoRefreshMs ?? (cycleSeconds ?? 80) * 1_000)
  );
  const samplingMs = Math.max(1_000, Math.round(cycleMs / 2));

  const settings: PipelineSettings = {
    matrices: {
      bases,
      quote,
      source: "binance",
      period: cycleMs,
      persist: true,
      window: "1h",
    },
    scales: {
      cycle: { period: cycleMs },
      sampling: { period: samplingMs },
      continuous: { period: "1s" },
    },
  };

  return settings;
}
