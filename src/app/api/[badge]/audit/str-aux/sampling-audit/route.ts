import { NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";
import { sql } from "@/core/db/db";

type SamplingWindowKey = "30m" | "1h" | "3h";

type LedgerRow = {
  id?: string;
  symbol: string | null;
  window_label: string | null;
  sample_ts: string | null;
  last_tick_ts: string | null;
  drift_ms: number | null;
  jitter_ms: number | null;
  produced_rows: number | null;
  status: string | null;
  last_error: string | null;
  cycle_id: string | null;
  marker_id: string | null;
  bytes_processed: number | null;
  rows_processed: number | null;
  updated_at: string | null;
};

type SamplingAudit = {
  ok: true;
  window: SamplingWindowKey;
  summary: {
    firstSampleTs: string | null;
    lastSampleTs: string | null;
    lastWindowUpdateTs: string | null;
    expectedSamples: number;
    actualSamples: number;
    coveragePct: number;
    lagMs: number | null;
  };
  ledger: Array<{
    symbol: string | null;
    sampleTs: string | null;
    lastTickTs: string | null;
    producedRows: number | null;
    driftMs: number | null;
    jitterMs: number | null;
    status: string;
    lastError: string | null;
    cycleId: string | null;
    markerId: string | null;
    bytesProcessed: number | null;
    rowsProcessed: number | null;
    updatedAt: string | null;
  }>;
  marker: {
    markerId: string | null;
    cycleId: string | null;
    startTs: string | null;
    lastUpdateTs: string | null;
    symbols: string[];
    rowsProcessed: number | null;
    bytesProcessed: number | null;
  };
};

const WINDOW_SECONDS: Record<SamplingWindowKey, number> = {
  "30m": 30 * 60,
  "1h": 60 * 60,
  "3h": 3 * 60 * 60,
};

function parseWindow(value: string | null): SamplingWindowKey {
  const v = (value ?? "").toLowerCase();
  return v === "1h" || v === "3h" ? (v as SamplingWindowKey) : "30m";
}

async function ensureLedgerTable() {
  await sql`
    DO $DDL$
    BEGIN
      EXECUTE 'CREATE SCHEMA IF NOT EXISTS str_aux';
      IF to_regclass('str_aux.sample_point_ledger') IS NULL THEN
        CREATE TABLE str_aux.sample_point_ledger (
          id bigserial PRIMARY KEY,
          symbol text,
          window_label text,
          sample_ts timestamptz,
          last_tick_ts timestamptz,
          drift_ms int,
          jitter_ms int,
          produced_rows int,
          status text,
          last_error text,
          cycle_id text,
          marker_id text,
          bytes_processed bigint,
          rows_processed int,
          user_id uuid,
          app_session_id text,
          updated_at timestamptz DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_sample_point_ledger_window
          ON str_aux.sample_point_ledger (window_label, sample_ts DESC);
        CREATE INDEX IF NOT EXISTS ix_sample_point_ledger_user
          ON str_aux.sample_point_ledger (user_id, window_label, sample_ts DESC);
      END IF;
    END
    $DDL$;
  `;
}

async function fetchLedger(windowKey: SamplingWindowKey, userId: string | null): Promise<LedgerRow[]> {
  const exists = await sql<{ present: boolean }>`
    SELECT to_regclass('str_aux.sample_point_ledger') IS NOT NULL AS present
  `;
  if (exists[0]?.present) {
    const rows = await sql<LedgerRow>`
      SELECT
        id,
        symbol,
        window_label,
        sample_ts,
        last_tick_ts,
        drift_ms,
        jitter_ms,
        produced_rows,
        status,
        last_error,
        cycle_id,
        marker_id,
        bytes_processed,
        rows_processed,
        updated_at
      FROM str_aux.sample_point_ledger
      WHERE window_label = ${windowKey}
        AND (${userId}::uuid IS NULL OR user_id = ${userId}::uuid OR user_id IS NULL)
      ORDER BY sample_ts DESC NULLS LAST, updated_at DESC
      LIMIT 8
    `;
    return rows;
  }

  const hasCycles = await sql<{ present: boolean }>`
    SELECT to_regclass('str_aux.cycles_40s') IS NOT NULL AS present
  `;
  if (hasCycles[0]?.present) {
    const fallback = await sql<LedgerRow>`
      SELECT
        NULL::text AS id,
        symbol,
        ${windowKey}::text AS window_label,
        cycle_start AS sample_ts,
        updated_at AS last_tick_ts,
        NULL::int AS drift_ms,
        NULL::int AS jitter_ms,
        NULL::int AS produced_rows,
        'unknown'::text AS status,
        NULL::text AS last_error,
        NULL::text AS cycle_id,
        NULL::text AS marker_id,
        NULL::bigint AS bytes_processed,
        NULL::int AS rows_processed,
        updated_at
      FROM str_aux.cycles_40s
      WHERE (${userId}::uuid IS NULL OR user_id = ${userId}::uuid OR user_id IS NULL)
      ORDER BY cycle_start DESC
      LIMIT 8
    `;
    return fallback;
  }

  return [];
}

export async function GET(
  req: Request,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;

  const resolved = await resolveBadgeRequestContext(req as any, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });

  const badge = resolved.badge;
  const userId = resolved.session.userId;
  const url = new URL(req.url);
  const windowKey = parseWindow(url.searchParams.get("window"));
  const windowSeconds = WINDOW_SECONDS[windowKey];

  await setRequestContext({
    userId,
    sessionId: badge,
    badgeParam: params?.badge ?? null,
    path: url.pathname,
    resolvedFromSessionMap: (resolved.session as any)?.resolvedFromSessionMap ?? false,
  });

  await ensureLedgerTable();

  const samplesPresent = await sql<{ present: boolean }>`
    SELECT to_regclass('str_aux.samples_5s') IS NOT NULL AS present
  `;

  const sampleAgg = samplesPresent[0]?.present
    ? (
        await sql<{
          first_ts: string | null;
          last_ts: string | null;
          samples: number | null;
        }>`
          SELECT
            MIN(ts) AS first_ts,
            MAX(ts) AS last_ts,
            COUNT(*)::bigint AS samples
          FROM str_aux.samples_5s
          WHERE ts >= now() - (${windowSeconds}::text || ' seconds')::interval
            AND (${userId}::uuid IS NULL OR user_id = ${userId}::uuid OR user_id IS NULL)
        `
      )[0]
    : { first_ts: null, last_ts: null, samples: 0 };

  const windowsPresent = await sql<{ present: boolean }>`
    SELECT to_regclass('str_aux.windows') IS NOT NULL AS present
  `;

  const windowAgg = windowsPresent[0]?.present
    ? (
        await sql<{
          last_window_start: string | null;
          last_window_update: string | null;
          cycles: number | null;
        }>`
          SELECT
            MAX(window_start) AS last_window_start,
            MAX(updated_at) AS last_window_update,
            SUM(cycles_count)::bigint AS cycles
          FROM str_aux.windows
          WHERE window_label = ${windowKey}
            AND (${userId}::uuid IS NULL OR user_id = ${userId}::uuid OR user_id IS NULL)
        `
      )[0]
    : { last_window_start: null, last_window_update: null, cycles: null };

  const ledgerRows = await fetchLedger(windowKey, userId);

  const expectedSamples = Math.round(windowSeconds / 5);
  const actualSamples = Number(sampleAgg?.samples ?? 0);
  const coveragePct = expectedSamples > 0 ? Math.max(0, Math.min(100, (actualSamples / expectedSamples) * 100)) : 0;

  const nowMs = Date.now();
  const lastSampleTsMs = sampleAgg?.last_ts ? new Date(sampleAgg.last_ts).getTime() : null;
  const lagMs = lastSampleTsMs ? Math.max(0, nowMs - lastSampleTsMs) : null;

  const ledger = ledgerRows.map((row) => {
    const statusRaw = (row.status ?? "").toUpperCase();
    const status =
      statusRaw === "OK" || statusRaw === "WARN" || statusRaw === "STALE" || statusRaw === "ERROR" || statusRaw === "GAP"
        ? statusRaw
        : "UNKNOWN";
    return {
      symbol: row.symbol,
      sampleTs: row.sample_ts,
      lastTickTs: row.last_tick_ts,
      producedRows: row.produced_rows ?? row.rows_processed ?? null,
      driftMs: row.drift_ms,
      jitterMs: row.jitter_ms,
      status,
      lastError: row.last_error,
      cycleId: row.cycle_id,
      markerId: row.marker_id,
      bytesProcessed: row.bytes_processed,
      rowsProcessed: row.rows_processed,
      updatedAt: row.updated_at,
    };
  });

  const symbols = Array.from(new Set(ledger.map((l) => l.symbol).filter(Boolean))) as string[];

  const marker = {
    markerId: ledger.find((l) => l.markerId)?.markerId ?? (windowAgg?.last_window_start ? `win:${windowAgg.last_window_start}` : null),
    cycleId: ledger.find((l) => l.cycleId)?.cycleId ?? null,
    startTs: windowAgg?.last_window_start ?? sampleAgg?.first_ts ?? null,
    lastUpdateTs: windowAgg?.last_window_update ?? sampleAgg?.last_ts ?? null,
    symbols,
    rowsProcessed: windowAgg?.cycles ?? ledger[0]?.rowsProcessed ?? null,
    bytesProcessed: ledger[0]?.bytesProcessed ?? null,
  };

  const body: SamplingAudit = {
    ok: true,
    window: windowKey,
    summary: {
      firstSampleTs: sampleAgg?.first_ts ?? null,
      lastSampleTs: sampleAgg?.last_ts ?? null,
      lastWindowUpdateTs: windowAgg?.last_window_update ?? null,
      expectedSamples,
      actualSamples,
      coveragePct,
      lagMs,
    },
    ledger,
    marker,
  };

  return NextResponse.json(body, { status: 200 });
}
