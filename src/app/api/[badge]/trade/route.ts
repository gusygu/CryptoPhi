import { NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import {
  commitMatrixGrid,
  getLatestByType,
  stageMatrixGrid,
  type MatrixGridObject,
} from "@/core/db/db";
import { fetchPairUniverseCoins } from "@/lib/settings/coin-universe";
import { withDbContext } from "@/core/db/pool_server";

type TradePayload = {
  symbol?: string;
  trades?: Array<{ time?: number; T?: number; transactTime?: number; symbol?: string }>;
  tradeTs?: number;
  coins?: string[];
  appSessionId?: string | null;
};

const U = (s: unknown) => String(s ?? "").trim().toUpperCase();
const KNOWN_QUOTES = ["USDT", "FDUSD", "USDC", "TUSD", "BUSD", "USD", "BTC", "ETH", "BNB"] as const;

function splitSymbol(sym: string): { base: string; quote: string } {
  const upper = U(sym);
  for (const q of KNOWN_QUOTES) {
    if (upper.endsWith(q) && upper.length > q.length) {
      return { base: upper.slice(0, -q.length), quote: q };
    }
  }
  return { base: upper, quote: "USDT" };
}

function dedupeCoins(list: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const item of list) {
    const c = U(item);
    if (!c) continue;
    set.add(c);
  }
  return Array.from(set);
}

function extractTradeTs(body: TradePayload): number | null {
  const parts: number[] = [];
  if (Number.isFinite(body.tradeTs)) parts.push(Number(body.tradeTs));
  for (const t of body.trades ?? []) {
    const raw = (t as any)?.time ?? (t as any)?.T ?? (t as any)?.transactTime;
    const num = Number(raw);
    if (Number.isFinite(num)) parts.push(num);
  }
  if (!parts.length) return null;
  return Math.max(...parts);
}

async function resolveCoinUniverse(body: TradePayload): Promise<string[]> {
  const coins = new Set<string>();
  const add = (c: string | null | undefined) => {
    const v = U(c);
    if (v) coins.add(v);
  };

  for (const c of body.coins ?? []) add(c);

  const pairCoins = await fetchPairUniverseCoins().catch(() => []);
  for (const c of pairCoins) add(c);

  if (body.symbol) {
    const { base, quote } = splitSymbol(body.symbol);
    add(base);
    add(quote);
  }

  for (const t of body.trades ?? []) {
    const sym = (t as any)?.symbol;
    if (sym) {
      const { base, quote } = splitSymbol(sym);
      add(base);
      add(quote);
    }
  }

  if (!coins.has("USDT")) coins.add("USDT");
  return Array.from(coins);
}

function rowsToValues(
  coins: string[],
  rows: { base: string; quote: string; value: number }[]
): MatrixGridObject {
  const values: MatrixGridObject = {};
  for (const c of coins) values[c] = {} as Record<string, number | null>;
  for (const row of rows) {
    const base = U(row.base);
    const quote = U(row.quote);
    if (!base || !quote || base === quote) continue;
    if (!values[base]) values[base] = {} as Record<string, number | null>;
    values[base][quote] = Number(row.value);
  }
  return values;
}

export async function PUT(req: Request, context: { params: { badge?: string } }) {
  const paramsMaybe = (context as any)?.params;
  const params =
    paramsMaybe && typeof paramsMaybe.then === "function" ? await paramsMaybe : paramsMaybe;
  const resolved = await resolveBadgeRequestContext(req as any, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = resolved.badge;
  const session = resolved.session;

  let body: TradePayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  try {
    const appSessionId = String(badge ?? "").trim();
    const tradeTs = extractTradeTs(body) ?? Date.now();

    const coins = dedupeCoins(await resolveCoinUniverse(body));
    if (!coins.length) {
      return NextResponse.json(
        { ok: false, error: "no coin universe available for trade snapshot" },
        { status: 400 }
      );
    }

    const latestBenchmark = await getLatestByType("benchmark", coins, appSessionId);
    if (!latestBenchmark?.values?.length) {
      return NextResponse.json(
        { ok: false, error: "no benchmark rows available to stamp trade", session: appSessionId },
        { status: 400 }
      );
    }

    const values = rowsToValues(coins, latestBenchmark.values as any);
    const stageRes = await withDbContext(
      {
        userId: session.userId,
        sessionId: badge,
        isAdmin: session.isAdmin,
        path: "/api/[badge]/trade",
        badgeParam: params?.badge ?? null,
        resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
      },
      async () =>
        stageMatrixGrid({
          appSessionId,
          matrixType: "benchmark_trade",
          tsMs: tradeTs,
          coins,
          values,
          meta: {
            source: "trade@put",
            trade_symbol: body.symbol ?? null,
            trade_count: Array.isArray(body.trades) ? body.trades.length : 0,
            trade_ts: tradeTs,
            benchmark_ts: latestBenchmark.ts_ms,
          },
          tradeStamp: true,
          tradeTs,
        }),
    );

    const commitRes = await withDbContext(
      {
        userId: session.userId,
        sessionId: badge,
        isAdmin: session.isAdmin,
        path: "/api/[badge]/trade",
        badgeParam: params?.badge ?? null,
        resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
      },
      async () =>
        commitMatrixGrid({
          appSessionId,
          matrixType: "benchmark_trade",
          tsMs: tradeTs,
          coins,
          idem: `trade:${tradeTs}`,
        }),
    );

    return NextResponse.json({
      ok: true,
      session: appSessionId,
      tradeTs,
      benchmarkTs: latestBenchmark.ts_ms,
      coins,
      staged: stageRes?.staged ?? 0,
      committed: (commitRes as any)?.staged_cells ?? null,
    });
  } catch (err: any) {
    console.error("[trade] ingest error", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "trade ingest failed" },
      { status: 500 }
    );
  }
}
