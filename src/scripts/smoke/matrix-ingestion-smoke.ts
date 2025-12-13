import "dotenv/config";
import { db } from "@/core/db/db";
import { runSystemRefresh } from "@/core/system/refresh";

type StepStatus = "ok" | "warn" | "fail";
type StepResult = { name: string; status: StepStatus; detail?: string };

const symbolEnv = process.env.MATRIX_SMOKE_SYMBOLS ?? process.env.SYMBOLS;
const maxSymbols = Math.max(1, Number(process.env.MATRIX_SMOKE_MAX_SYMBOLS ?? 3));
const klinesInterval = process.env.MATRIX_SMOKE_KLINES_INTERVAL ?? "1m";
const windowLabel = process.env.MATRIX_SMOKE_WINDOW ?? "1h";
const pollerId = process.env.MATRIX_SMOKE_POLLER_ID ?? "matrix-smoke";
const skipMatrices = process.env.MATRIX_SMOKE_SKIP_MATRICES === "1";

async function pickSymbols(): Promise<string[]> {
  if (symbolEnv && symbolEnv.trim()) {
    return symbolEnv
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, maxSymbols);
  }

  const { rows } = await db.query<{ symbol: string }>(
    `
      select symbol::text
        from settings.coin_universe
       where coalesce(enabled, true) = true
       order by symbol
       limit $1
    `,
    [maxSymbols],
  );
  if (rows.length) return rows.map((r) => r.symbol.toUpperCase());

  return ["BTCUSDT", "ETHUSDT"].slice(0, maxSymbols);
}

const results: StepResult[] = [];

async function runStep(name: string, fn: () => Promise<StepResult | void>) {
  const started = Date.now();
  try {
    const res = (await fn()) ?? { status: "ok" as StepStatus };
    const detail = res.detail ? ` - ${res.detail}` : "";
    console.log(`[${res.status}] ${name}${detail} (${Date.now() - started}ms)`);
    results.push({ name, status: res.status, detail: res.detail });
  } catch (err: any) {
    const detail = err instanceof Error ? err.message : String(err ?? "error");
    console.error(`[fail] ${name}: ${detail}`);
    results.push({ name, status: "fail", detail });
  }
}

async function checkUniverse(symbols: string[]): Promise<StepResult> {
  if (!symbols.length) {
    throw new Error("No symbols selected for smoke");
  }
  return { status: "ok", detail: `symbols=${symbols.join(",")}` };
}

async function runRefresh(symbols: string[]): Promise<StepResult> {
  const refresh = await runSystemRefresh({
    symbols,
    klinesInterval,
    pollerId,
    window: windowLabel,
    recordTelemetry: false,
  });
  const okSteps = refresh.steps.filter((s) => s.ok).length;
  const failedSteps = refresh.steps.filter((s) => !s.ok);
  if (failedSteps.length) {
    const first = failedSteps[0];
    throw new Error(`refresh step failed: ${first.name} (${first.error ?? "error"})`);
  }
  return {
    status: "ok",
    detail: `steps=${okSteps}, duration=${refresh.finishedAt - refresh.startedAt}ms`,
  };
}

async function checkKlines(symbols: string[]): Promise<StepResult> {
  const { rows } = await db.query<{ symbol: string; rows: string }>(
    `
      select symbol, count(*)::bigint as rows
        from market.klines
       where symbol = any($1)
         and close_time >= now() - interval '1 day'
       group by 1
    `,
    [symbols],
  );
  const missing = symbols.filter(
    (sym) => !rows.some((r) => r.symbol.toUpperCase() === sym.toUpperCase()),
  );
  if (missing.length) {
    throw new Error(`no klines in last 24h for: ${missing.join(",")}`);
  }
  return {
    status: "ok",
    detail: rows
      .map((r) => `${r.symbol}:${r.rows}`)
      .join(" "),
  };
}

async function checkMatrices(): Promise<StepResult> {
  const { rows } = await db.query<{ matrix_type: string; rows: string }>(
    `
      with latest as (
        select max(ts_ms) as ts_ms from matrices.dyn_values
      )
      select matrix_type, count(*)::bigint as rows
        from matrices.dyn_values, latest
       where matrices.dyn_values.ts_ms = latest.ts_ms
       group by matrix_type
       order by matrix_type
    `,
  );
  if (!rows.length) {
    throw new Error("no matrices.dyn_values rows found");
  }
  return {
    status: "ok",
    detail: rows
      .map((r) => `${r.matrix_type}:${r.rows}`)
      .join(" "),
  };
}

async function main() {
  const symbols = await pickSymbols();
  console.log(
    `[matrix-ingestion-smoke] symbols=${symbols.join(",")} klines=${klinesInterval} window=${windowLabel} poller=${pollerId}`,
  );

  await runStep("universe", () => checkUniverse(symbols));
  await runStep("system:refresh", () => runRefresh(symbols));
  await runStep("market.klines recent", () => checkKlines(symbols));
  if (!skipMatrices) {
    await runStep("matrices.dyn_values latest", checkMatrices);
  } else {
    results.push({ name: "matrices.dyn_values latest", status: "warn", detail: "skipped" });
    console.log("[warn] matrices.dyn_values latest - skipped (MATRIX_SMOKE_SKIP_MATRICES=1)");
  }

  const failed = results.filter((r) => r.status === "fail");
  console.log(
    `[matrix-ingestion-smoke] done ok=${results.filter((r) => r.status === "ok").length
    } warn=${results.filter((r) => r.status === "warn").length} fail=${failed.length}`,
  );
  if (failed.length) process.exitCode = 1;
}

void main().catch((err) => {
  console.error("[matrix-ingestion-smoke] fatal", err);
  process.exit(1);
});
