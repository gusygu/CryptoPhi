import "dotenv/config";

import { runSystemRefresh } from "@/core/system/refresh";
import { fetchCoinUniverseEntries, syncCoinUniverseFromBases } from "@/lib/settings/coin-universe";

const runFlag = process.env.RUN_JOBS ?? process.env.RUN_JON;
const runEnabled =
  runFlag === "1" || (typeof runFlag === "string" && runFlag.toLowerCase() === "true");

const REFRESH_MS = Math.max(
  30_000,
  Number(process.env.AUTO_INGEST_REFRESH_MS ?? process.env.INGEST_REFRESH_MS ?? 180_000),
);
const KLINES_INTERVAL =
  process.env.AUTO_INGEST_KLINES_INTERVAL ??
  process.env.INGEST_KLINES_INTERVAL ??
  process.env.INFLOW_KLINES_INTERVAL ??
  "1m";
const WINDOW_LABEL =
  process.env.AUTO_INGEST_WINDOW ?? process.env.MATRICES_REFRESH_WINDOW ?? "1h";
const POLLER_ID =
  process.env.AUTO_INGEST_POLLER_ID ??
  process.env.INGEST_POLLER_ID ??
  process.env.INFLOW_POLLER_ID ??
  "benchmark-auto-ingest";

const DEFAULT_BASES = ["BTC", "ETH", "BNB", "SOL", "ADA"];

function parseList(input?: string): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function envBases(): string[] {
  const bases = parseList(
    process.env.AUTO_INGEST_BASES ?? process.env.INGEST_BASES ?? process.env.SYMBOLS,
  ).filter((b) => b && b !== "USDT");
  return bases.length ? bases : DEFAULT_BASES;
}

function envSymbolsOverride(): string[] | undefined {
  const symbols = parseList(
    process.env.AUTO_INGEST_SYMBOLS ?? process.env.INGEST_SYMBOLS ?? process.env.SYMBOLS,
  );
  return symbols.length ? symbols : undefined;
}

async function seedCoinUniverse() {
  const bases = envBases();
  if (!bases.length) return;
  try {
    await syncCoinUniverseFromBases(bases);
    console.log(`[benchmark-auto-ingest] synced coin universe for ${bases.length} bases`);
  } catch (err) {
    console.warn("[benchmark-auto-ingest] coin universe seed skipped:", err);
  }
}

async function resolveSymbols(): Promise<string[]> {
  const override = envSymbolsOverride();
  if (override?.length) return override;

  const entries = await fetchCoinUniverseEntries({ onlyEnabled: true });
  if (entries.length) {
    return entries.map((e) => e.symbol.toUpperCase());
  }

  const fallback = envBases().map((b) => `${b}USDT`);
  return Array.from(new Set(fallback));
}

async function ingestOnce(tag: string) {
  const symbols = await resolveSymbols();
  if (!symbols.length) throw new Error("no symbols resolved for ingestion");

  const res = await runSystemRefresh({
    symbols,
    klinesInterval: KLINES_INTERVAL,
    window: WINDOW_LABEL,
    pollerId: tag,
    appSessionId: tag,
  });
  const okSteps = res.steps.filter((s) => s.ok).length;
  const fail = res.steps.find((s) => !s.ok);
  console.log(
    `[benchmark-auto-ingest] symbols=${symbols.length} steps=${okSteps}/${res.steps.length} ` +
      `duration=${res.finishedAt - res.startedAt}ms${fail ? ` first_error=${fail.error}` : ""}`,
  );
}

async function loop(tag: string) {
  const started = Date.now();
  try {
    await ingestOnce(tag);
  } catch (err) {
    console.error("[benchmark-auto-ingest] cycle error:", err);
  }
  const elapsed = Date.now() - started;
  const wait = Math.max(5_000, REFRESH_MS - elapsed);
  setTimeout(() => void loop(tag), wait);
}

console.log(
  `[benchmark-auto-ingest] boot refresh=${REFRESH_MS}ms klines=${KLINES_INTERVAL} window=${WINDOW_LABEL} poller=${POLLER_ID}`,
);
console.log("jobs: starting (set RUN_JOBS=1 or RUN_JON=1 to enable background workers)");

if (!runEnabled) {
  console.log("jobs: disabled (RUN_JOBS/RUN_JON!=1). Exiting gracefully.");
  process.exit(0);
}

seedCoinUniverse()
  .then(() => ingestOnce(POLLER_ID))
  .then(() => loop(POLLER_ID))
  .catch((err) => {
    console.error("[benchmark-auto-ingest] bootstrap failed:", err);
    process.exit(1);
  });
