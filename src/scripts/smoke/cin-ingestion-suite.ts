import "dotenv/config";
import { db } from "@/core/db/db";
import { getAccountBalances } from "@/core/sources/binanceAccount";

type StepStatus = "ok" | "fail" | "skip";
type StepResult = { name: string; status: StepStatus; detail?: string };

const sessionId = Number(
  process.env.CIN_RUNTIME_SESSION_ID ??
    process.env.CIN_SMOKE_SESSION_ID ??
    "",
);
if (!Number.isFinite(sessionId) || sessionId <= 0) {
  throw new Error("Set CIN_RUNTIME_SESSION_ID (or CIN_SMOKE_SESSION_ID) to a valid runtime session id.");
}

const baseUrl = process.env.CIN_SMOKE_BASE_URL ?? "http://localhost:3000";
const accountScope =
  (process.env.CIN_SMOKE_ACCOUNT_SCOPE ??
    process.env.CIN_WATCH_ACCOUNT_SCOPE ??
    "__env__")?.toLowerCase() || "__env__";
const requireBinance = process.env.CIN_SMOKE_REQUIRE_BINANCE === "1";
const skipApi = process.env.CIN_SMOKE_SKIP_API === "1";
const maxStaleMinutes = Math.max(
  1,
  Number(process.env.CIN_SMOKE_MAX_STALE_MINUTES ?? 60),
);

const results: StepResult[] = [];

async function runStep(
  name: string,
  fn: () => Promise<StepResult | void>,
): Promise<void> {
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

async function checkDdl(): Promise<StepResult> {
  const expected = [
    ["settings", "coin_universe"],
    ["market", "account_trades"],
    ["cin_aux", "rt_session"],
    ["cin_aux", "rt_balance"],
  ];
  const { rows } = await db.query<{
    schemaname: string;
    tablename: string;
  }>(
    `
      select schemaname, tablename
        from pg_tables
       where (schemaname, tablename) in (('settings','coin_universe'),
                                         ('market','account_trades'),
                                         ('cin_aux','rt_session'),
                                         ('cin_aux','rt_balance'))
    `,
  );
  const missing = expected.filter(
    ([schema, table]) =>
      !rows.some((r) => r.schemaname === schema && r.tablename === table),
  );
  if (missing.length) {
    const detail = missing.map(([s, t]) => `${s}.${t}`).join(", ");
    throw new Error(`Missing tables: ${detail}`);
  }
  return { status: "ok", detail: "core tables present" };
}

async function checkSession(): Promise<StepResult> {
  const { rows } = await db.query<{
    owner_user_id: string | null;
    status: string | null;
    started_at: string | null;
    window_label: string | null;
  }>(
    `
      select owner_user_id, status, started_at, window_label
        from cin_aux.rt_session
       where session_id = $1
       limit 1
    `,
    [sessionId],
  );
  if (!rows.length) {
    throw new Error(
      `cin_aux.rt_session missing row for session_id=${sessionId} (create/open a runtime session first)`,
    );
  }
  const row = rows[0];
  const owner = row.owner_user_id ?? "null";
  if (!row.owner_user_id) {
    throw new Error(
      `runtime session ${sessionId} has no owner_user_id (assign via /api/cin-aux/runtime)`,
    );
  }
  return {
    status: "ok",
    detail: `owner=${owner} status=${row.status ?? "null"} window=${row.window_label ?? "?"}`,
  };
}

async function checkEntrypoint(): Promise<StepResult> {
  try {
    const balances = await getAccountBalances();
    const entries = Object.entries(balances ?? {}).filter(
      ([, units]) => Number(units) > 0,
    );
    return {
      status: "ok",
      detail: `Binance balances ok (${Object.keys(balances ?? {}).length} assets, ${entries.length} non-zero)`,
    };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : String(err ?? "entrypoint failed");
    if (requireBinance) {
      throw new Error(`Binance entrypoint failed: ${detail}`);
    }
    return { status: "skip", detail: `Binance skipped (${detail})` };
  }
}

async function checkServerHealth(): Promise<StepResult> {
  const res = await fetch(`${baseUrl}/api/engine/vitals/health`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`/api/engine/vitals/health HTTP ${res.status}`);
  }
  const json = (await res.json()) as { ok?: boolean; db?: string };
  if (!json?.ok) {
    throw new Error(`health endpoint returned ok=false (db=${json?.db ?? "?"})`);
  }
  return { status: "ok", detail: `db=${json.db ?? "up"}` };
}

async function checkTrades(): Promise<StepResult> {
  const { rows } = await db.query<{
    total: string | null;
    recent: string | null;
    max_trade_time: string | null;
  }>(
    `
      select count(*) as total,
             count(*) filter (where trade_time >= now() - $2::interval) as recent,
             max(trade_time) as max_trade_time
        from market.account_trades
       where account_email is not distinct from $1
    `,
    [accountScope, `${maxStaleMinutes} minutes`],
  );
  const row = rows[0] ?? {};
  const total = Number(row.total ?? 0);
  const recent = Number(row.recent ?? 0);
  const maxTs = row.max_trade_time ? new Date(row.max_trade_time).getTime() : 0;
  if (!total) {
    throw new Error(
      `no rows in market.account_trades for account_scope=${accountScope}`,
    );
  }
  const ageMinutes = maxTs ? (Date.now() - maxTs) / 60000 : Infinity;
  if (!recent || ageMinutes > maxStaleMinutes) {
    throw new Error(
      `latest trade is stale (${ageMinutes.toFixed(
        1,
      )}m > ${maxStaleMinutes}m). Check poller settings.`,
    );
  }
  return {
    status: "ok",
    detail: `trades ok (${total} total, latest ${(ageMinutes || 0).toFixed(1)}m ago)`,
  };
}

async function checkPipeline(): Promise<StepResult> {
  const { rows: importRows } = await db.query<{
    import_moves_from_account_trades: number;
  }>(`select cin_aux.import_moves_from_account_trades($1,$2)`, [
    sessionId,
    accountScope,
  ]);
  const imported = Number(
    importRows[0]?.import_moves_from_account_trades ?? 0,
  );

  const { rows: balances } = await db.query<{
    asset_id: string;
    principal_usdt: string | null;
    profit_usdt: string | null;
  }>(
    `
      select asset_id, principal_usdt, profit_usdt
        from cin_aux.rt_balance
       where session_id = $1
       order by asset_id asc
       limit 5
    `,
    [sessionId],
  );
  if (!balances.length) {
    throw new Error("cin_aux.rt_balance empty for session");
  }
  return {
    status: "ok",
    detail: `moves imported=${imported}, balances rows=${balances.length}`,
  };
}

async function checkClientApi(): Promise<StepResult> {
  const balRes = await fetch(
    `${baseUrl}/api/cin-aux/runtime/sessions/${sessionId}/balances`,
    { cache: "no-store" },
  );
  if (!balRes.ok) {
    throw new Error(`/balances HTTP ${balRes.status}`);
  }
  const balJson = await balRes.json();
  const moveRes = await fetch(
    `${baseUrl}/api/cin-aux/runtime/sessions/${sessionId}/moves`,
    { cache: "no-store" },
  );
  if (!moveRes.ok) {
    throw new Error(`/moves HTTP ${moveRes.status}`);
  }
  const moveJson = await moveRes.json();
  const assets = Array.isArray(balJson?.assets) ? balJson.assets.length : 0;
  const moves = Array.isArray(moveJson) ? moveJson.length : 0;
  return { status: "ok", detail: `api ok (assets=${assets}, moves=${moves})` };
}

async function main() {
  console.log(
    `[cin-ingestion-suite] session=${sessionId} scope=${accountScope} baseUrl=${baseUrl}`,
  );

  await runStep("DDL / core tables", checkDdl);
  await runStep("runtime session registration", checkSession);
  await runStep("entrypoint (Binance /api/v3/account)", checkEntrypoint);
  await runStep("server health endpoint", checkServerHealth);
  await runStep("ingestion freshness (account_trades)", checkTrades);
  await runStep("pipeline (import moves + balances)", checkPipeline);
  if (!skipApi) {
    await runStep("client API (balances + moves)", checkClientApi);
  } else {
    results.push({ name: "client API (balances + moves)", status: "skip" });
    console.log("[skip] client API checks (CIN_SMOKE_SKIP_API=1)");
  }

  const failed = results.filter((r) => r.status === "fail");
  console.log(
    `[cin-ingestion-suite] completed: ok=${results.filter((r) => r.status === "ok").length
    } skip=${results.filter((r) => r.status === "skip").length} fail=${failed.length}`,
  );
  if (failed.length) {
    process.exitCode = 1;
  }
}

void main();
