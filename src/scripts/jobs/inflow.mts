import "dotenv/config";
import { ingestTickerSymbols, ingestKlinesSymbols } from "@/core/system/tasks";
import { fetchCoinUniverseEntries } from "@/lib/settings/coin-universe";

const KLINES_INTERVAL =
  process.env.INFLOW_KLINES_INTERVAL ?? process.env.INGEST_KLINES_INTERVAL ?? "1m";
const KLINES_LIMIT = Number(process.env.INFLOW_KLINES_LIMIT ?? 200);

function parseSymbols(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
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

async function main() {
  const symbols = await resolveSymbols();
  if (!symbols.length) {
    throw new Error("inflow: no symbols resolved from coin universe");
  }

  console.log(
    `[inflow.mts] start symbols=${symbols.length} interval=${KLINES_INTERVAL} limit=${KLINES_LIMIT}`,
  );

  const tickerWrites = await ingestTickerSymbols(symbols);
  const klineWrites = await ingestKlinesSymbols(symbols, KLINES_INTERVAL, KLINES_LIMIT);

  console.log(
    `[inflow.mts] done ticker=${tickerWrites} klines=${klineWrites} symbols=${symbols.length}`,
  );
}

void main().catch((err) => {
  console.error("[inflow.mts] fatal", err);
  process.exit(1);
});
