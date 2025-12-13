import "dotenv/config";
import { ingestKlinesSymbols, ingestTickerSymbols } from "@/core/system/tasks";
import { fetchCoinUniverseEntries } from "@/lib/settings/coin-universe";

const REFRESH_MS = Math.max(10_000, Number(process.env.INFLOW_REFRESH_MS ?? 120_000));
const KLINES_INTERVAL =
  process.env.INFLOW_KLINES_INTERVAL ?? process.env.INGEST_KLINES_INTERVAL ?? "1m";
const KLINES_LIMIT = Number(process.env.INFLOW_KLINES_LIMIT ?? 200);
const POLLER_ID = process.env.INFLOW_POLLER_ID ?? "inflow";

function parseSymbols(input?: string): string[] | undefined {
  if (!input) return undefined;
  const list = input
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : undefined;
}

async function resolveSymbols(): Promise<string[]> {
  const fromEnv = parseSymbols(process.env.INFLOW_SYMBOLS ?? process.env.INGEST_SYMBOLS);
  if (fromEnv?.length) return fromEnv;

  const entries = await fetchCoinUniverseEntries({ onlyEnabled: true });
  return entries.map((e) => e.symbol.toUpperCase());
}

async function runOnce() {
  const symbols = await resolveSymbols();
  if (!symbols.length) {
    throw new Error("inflow: no symbols resolved from coin universe");
  }

  const tickerWrites = await ingestTickerSymbols(symbols);
  const klineWrites = await ingestKlinesSymbols(symbols, KLINES_INTERVAL, KLINES_LIMIT);

  console.log(
    `[inflow] poller=${POLLER_ID} symbols=${symbols.length} ` +
      `klines=${klineWrites} interval=${KLINES_INTERVAL} ticker=${tickerWrites}`,
  );
}

async function loop() {
  const started = Date.now();
  try {
    await runOnce();
  } catch (err) {
    console.error("[inflow] cycle error", err);
  }
  const elapsed = Date.now() - started;
  const wait = Math.max(5_000, REFRESH_MS - elapsed);
  setTimeout(() => void loop(), wait);
}

console.log(
  `[inflow] boot poller=${POLLER_ID} interval=${REFRESH_MS}ms klines=${KLINES_INTERVAL} limit=${KLINES_LIMIT}`,
);

void loop();
