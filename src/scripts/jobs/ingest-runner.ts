import "dotenv/config";
import { runSystemRefresh } from "@/core/system/refresh";

const REFRESH_MS = Math.max(30_000, Number(process.env.INGEST_REFRESH_MS ?? 300_000));
const klinesInterval = process.env.INGEST_KLINES_INTERVAL ?? "1m";
const pollerId = process.env.INGEST_POLLER_ID ?? "ingest-runner";
const windowLabel = process.env.INGEST_WINDOW ?? "1h";
const telemetry = process.env.INGEST_TELEMETRY !== "0";

function parseSymbols(input?: string): string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

const symbols = parseSymbols(process.env.INGEST_SYMBOLS);

async function tick() {
  const started = Date.now();
  try {
    const res = await runSystemRefresh({
      symbols,
      klinesInterval,
      pollerId,
      window: windowLabel,
      recordTelemetry: telemetry,
      appSessionId: pollerId,
    });
    const okSteps = res.steps.filter((s) => s.ok).length;
    const failSteps = res.steps.filter((s) => !s.ok);
    if (failSteps.length) {
      console.warn(
        `[ingest-runner] step failed: ${failSteps[0]!.name} (${failSteps[0]!.error ?? "error"})`,
      );
    }
    console.log(
      `[ingest-runner] symbols=${res.symbols.length} steps=${okSteps}/${res.steps.length} duration=${res.finishedAt - res.startedAt}ms`,
    );
  } catch (err) {
    console.error("[ingest-runner] refresh error:", err);
  }
  const elapsed = Date.now() - started;
  const wait = Math.max(5_000, REFRESH_MS - elapsed);
  setTimeout(() => {
    void tick();
  }, wait);
}

console.log(
  `[ingest-runner] boot interval=${REFRESH_MS}ms klines=${klinesInterval} window=${windowLabel} poller=${pollerId} symbols=${symbols ? symbols.join(",") : "universe"}`,
);

void tick();
