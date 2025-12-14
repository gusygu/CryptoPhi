// src/core/db/db.ts
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { db, getPool, query, withClient, withDbContext } from "./pool_server";
import { resolveRequestBadge } from "@/lib/server/badge";

export { db, getPool, query, withClient, withDbContext } from "./pool_server";
export { sql } from "./session";
export type { SqlTag } from "./session";

/** ------- Dynamics matrices (kept signatures) ------- */
// Optional env override; defaults to our canonical table
const RAW_TABLE = process.env.MATRIX_TABLE || "matrices.dyn_values";

// Prevent SQL injection on identifier
function asIdent(name: string) {
  const parts = String(name).split(".").filter(Boolean);
  if (!parts.length) throw new Error(`Invalid table identifier: ${name}`);
  return parts.map((part) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      throw new Error(`Invalid table identifier: ${name}`);
    }
    return `"${part}"`;
  }).join(".");
}
const TABLE = asIdent(RAW_TABLE);

const RAW_STAGE_TABLE =
  process.env.MATRIX_STAGE_TABLE || "matrices.dyn_values_stage";
const RAW_COMMIT_TABLE =
  process.env.MATRIX_COMMIT_TABLE ||
  process.env.MATRIX_TABLE ||
  "matrices.dyn_values";

const STAGE_TABLE_CANDIDATES = Array.from(
  new Set(
    [
      process.env.MATRIX_STAGE_TABLE,
      "matrices.dyn_values_stage",
      "public.dyn_matrix_values_stage",
    ].filter(Boolean) as string[]
  )
);

const MATRIX_TABLE_CANDIDATES = Array.from(
  new Set(
    [
      process.env.MATRIX_COMMIT_TABLE,
      process.env.MATRIX_TABLE,
      "matrices.dyn_values",
      "public.dyn_matrix_values",
    ].filter(Boolean) as string[]
  )
);

type RelationInfo = { raw: string; ident: string; kind: string };

function splitQualifiedName(name: string): { schema: string; relation: string } {
  const parts = String(name).split(".");
  if (parts.length === 1) return { schema: "public", relation: parts[0]! };
  const relation = parts.pop()!;
  return { schema: parts.join("."), relation };
}

async function ensureMatrixTables(client: PoolClient) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS matrices`);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'matrices'
          AND c.relname = 'dyn_values'
          AND c.relkind IN ('v','m')
      ) THEN
        EXECUTE 'DROP VIEW IF EXISTS matrices.dyn_values CASCADE';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'matrices'
          AND c.relname = 'dyn_values_stage'
          AND c.relkind IN ('v','m')
      ) THEN
        EXECUTE 'DROP VIEW IF EXISTS matrices.dyn_values_stage CASCADE';
      END IF;
    END
    $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS matrices.dyn_values (
      ts_ms         bigint           NOT NULL,
      matrix_type   text             NOT NULL CHECK (matrix_type IN ('benchmark','benchmark_trade','delta','pct24h','id_pct','pct_drv','ref','pct_ref','pct_snap','snap','pct_traded','traded')),
      base          text             NOT NULL,
      quote         text             NOT NULL,
      value         double precision NOT NULL,
      meta          jsonb            NOT NULL DEFAULT '{}'::jsonb,
      opening_stamp boolean          NOT NULL DEFAULT false,
      opening_ts    timestamptz,
      snapshot_stamp boolean         NOT NULL DEFAULT false,
      snapshot_ts   timestamptz,
      trade_stamp   boolean          NOT NULL DEFAULT false,
      trade_ts      timestamptz,
      created_at    timestamptz      NOT NULL DEFAULT now(),
      PRIMARY KEY (ts_ms, matrix_type, base, quote),
      CHECK (opening_stamp = false OR opening_ts IS NOT NULL),
      CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL),
      CHECK (trade_stamp = false OR trade_ts IS NOT NULL)
    )
  `);
  await client.query(`
    ALTER TABLE matrices.dyn_values
      ADD COLUMN IF NOT EXISTS trade_stamp boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS trade_ts timestamptz
  `);
  await client.query(`
    ALTER TABLE matrices.dyn_values
      DROP CONSTRAINT IF EXISTS dyn_values_matrix_type_check;
    ALTER TABLE matrices.dyn_values
      ADD CONSTRAINT dyn_values_matrix_type_check
        CHECK (matrix_type IN ('benchmark','benchmark_trade','delta','pct24h','id_pct','pct_drv','ref','pct_ref','pct_snap','snap','pct_traded','traded'))
  `);
  await client.query(`
    ALTER TABLE matrices.dyn_values
      DROP CONSTRAINT IF EXISTS chk_dyn_values_trade_ts;
    ALTER TABLE matrices.dyn_values
      ADD CONSTRAINT chk_dyn_values_trade_ts CHECK (trade_stamp = false OR trade_ts IS NOT NULL)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_matrices_dyn_values_pair
      ON matrices.dyn_values (matrix_type, base, quote, ts_ms DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_dyn_values_trade
      ON matrices.dyn_values (matrix_type, trade_stamp, trade_ts DESC, ts_ms DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_dyn_values_trade_session
      ON matrices.dyn_values ((coalesce(meta->>'app_session_id','global')), trade_stamp, trade_ts DESC)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS matrices.dyn_values_stage (
      ts_ms          bigint           NOT NULL,
      matrix_type    text             NOT NULL,
      base           text             NOT NULL,
      quote          text             NOT NULL,
      value          double precision NOT NULL,
      meta           jsonb            NOT NULL DEFAULT '{}'::jsonb,
      app_session_id text,
      opening_stamp  boolean          NOT NULL DEFAULT false,
      opening_ts     timestamptz,
      snapshot_stamp boolean          NOT NULL DEFAULT false,
      snapshot_ts    timestamptz,
      trade_stamp    boolean          NOT NULL DEFAULT false,
      trade_ts       timestamptz,
      created_at     timestamptz      NOT NULL DEFAULT now(),
      PRIMARY KEY (ts_ms, matrix_type, base, quote),
      CHECK (opening_stamp = false OR opening_ts IS NOT NULL),
      CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL),
      CHECK (trade_stamp = false OR trade_ts IS NOT NULL)
    )
  `);
  await client.query(`
    ALTER TABLE matrices.dyn_values_stage
      ADD COLUMN IF NOT EXISTS trade_stamp boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS trade_ts timestamptz
  `);
  await client.query(`
    ALTER TABLE matrices.dyn_values_stage
      DROP CONSTRAINT IF EXISTS chk_dyn_stage_trade_ts;
    ALTER TABLE matrices.dyn_values_stage
      ADD CONSTRAINT chk_dyn_stage_trade_ts CHECK (trade_stamp = false OR trade_ts IS NOT NULL)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_dyn_stage_trade
      ON matrices.dyn_values_stage (trade_stamp, trade_ts DESC, ts_ms DESC)
  `);
}

async function findExistingTable(
  client: PoolClient,
  candidates: string[]
): Promise<RelationInfo | null> {
  for (const raw of candidates) {
    const { schema, relation } = splitQualifiedName(raw);
    const { rows } = await client.query<{ kind?: string }>(
      `
        SELECT c.relkind AS kind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2
      `,
      [schema, relation]
    );
    const kind = rows[0]?.kind;
    if (kind && (kind === "r" || kind === "p")) {
      return { raw, ident: asIdent(raw), kind };
    }
  }
  return null;
}

let cachedStageInfo: RelationInfo | null = null;
let cachedMatrixInfo: RelationInfo | null = null;

async function ensureStageInfo(client: PoolClient): Promise<RelationInfo> {
  if (cachedStageInfo) return cachedStageInfo;
  let info =
    (await findExistingTable(client, [RAW_STAGE_TABLE, ...STAGE_TABLE_CANDIDATES])) ??
    (await findExistingTable(client, STAGE_TABLE_CANDIDATES));
  if (!info) {
    await ensureMatrixTables(client);
    info =
      (await findExistingTable(client, [RAW_STAGE_TABLE, ...STAGE_TABLE_CANDIDATES])) ??
      (await findExistingTable(client, STAGE_TABLE_CANDIDATES));
    if (!info) {
      throw new Error(
        `Matrix stage table not found. Checked: ${[
          RAW_STAGE_TABLE,
          ...STAGE_TABLE_CANDIDATES,
        ]
          .filter(Boolean)
          .join(", ")}`
      );
    }
  }
  cachedStageInfo = info;
  return info;
}

async function ensureMatrixInfo(client: PoolClient): Promise<RelationInfo> {
  if (cachedMatrixInfo) return cachedMatrixInfo;
  let info =
    (await findExistingTable(client, [RAW_COMMIT_TABLE, ...MATRIX_TABLE_CANDIDATES])) ??
    (await findExistingTable(client, MATRIX_TABLE_CANDIDATES));
  if (!info) {
    await ensureMatrixTables(client);
    info =
      (await findExistingTable(client, [RAW_COMMIT_TABLE, ...MATRIX_TABLE_CANDIDATES])) ??
      (await findExistingTable(client, MATRIX_TABLE_CANDIDATES));
    if (!info) {
      throw new Error(
        `Matrix values table not found. Checked: ${[
          RAW_COMMIT_TABLE,
          ...MATRIX_TABLE_CANDIDATES,
        ]
          .filter(Boolean)
          .join(", ")}`
      );
    }
  }
  if (!info) {
    throw new Error(
      `Matrix values table not found. Checked: ${[
        RAW_COMMIT_TABLE,
        ...MATRIX_TABLE_CANDIDATES,
      ]
        .filter(Boolean)
        .join(", ")}`
    );
  }
  cachedMatrixInfo = info;
  return info;
}

function dedupeUpper(xs: readonly string[] | undefined | null): string[] {
  if (!xs?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const up = String(x ?? "").trim().toUpperCase();
    if (!up || seen.has(up)) continue;
    seen.add(up);
    out.push(up);
  }
  return out;
}

const openingStampedSessions = new Set<string>();
async function currentRequestSessionId(): Promise<string | null> {
  try {
    const badge = await resolveRequestBadge();
    return badge || null;
  } catch {
    return null;
  }
}
export async function normalizeSessionId(id: string | null | undefined): Promise<string> {
  const fromHeader = await currentRequestSessionId();
  const s = String(id ?? fromHeader ?? "").trim();
  return s || "global";
}

export async function markOpeningStampOnce(appSessionId: string | null | undefined, tsMs: number): Promise<{
  openingStamp: boolean;
  openingTs: number;
}> {
  const key = await normalizeSessionId(appSessionId);
  if (openingStampedSessions.has(key)) {
    return { openingStamp: false, openingTs: tsMs };
  }
  openingStampedSessions.add(key);
  return { openingStamp: true, openingTs: tsMs };
}

async function shouldStampOpeningOnce(
  client: PoolClient,
  appSessionId: string | null | undefined,
  tsMs: number
): Promise<{ openingStamp: boolean; openingTs: number }> {
  const key = await normalizeSessionId(appSessionId);
  if (openingStampedSessions.has(key)) {
    return { openingStamp: false, openingTs: tsMs };
  }
  try {
    const { rows } = await client.query<{ has: boolean }>(
      `select exists(
         select 1
           from matrices.dyn_values
          where matrix_type = 'benchmark'
            and opening_stamp = true
            and coalesce(meta->>'app_session_id','global') = $1
       ) as has`,
      [key]
    );
    if (rows[0]?.has) {
      openingStampedSessions.add(key);
      return { openingStamp: false, openingTs: tsMs };
    }
  } catch {
    // fall through to allow stamping if check fails
  }
  openingStampedSessions.add(key);
  return { openingStamp: true, openingTs: tsMs };
}

export async function getMatrixStageTableIdent(
  client?: PoolClient
): Promise<string> {
  if (cachedStageInfo) return cachedStageInfo.ident;
  const useClient = client ?? (await db.connect());
  const release = !client;
  try {
    const info = await ensureStageInfo(useClient);
    return info.ident;
  } finally {
    if (release) useClient.release();
  }
}

async function getMatrixValuesTableIdent(
  client: PoolClient
): Promise<string> {
  const info = await ensureMatrixInfo(client);
  return info.ident;
}

/** Matrix type union (aligns with DDL) */
export type MatrixType =
  | "benchmark"
  | "benchmark_trade"
  | "delta"
  | "pct24h"
  | "id_pct"
  | "pct_drv"
  | "ref"
  | "pct_ref"
  | "pct_snap"
  | "snap"
  | "pct_traded"
  | "traded";

/** Bulk upsert directly into main table (bypasses stage/commit) */
export async function upsertMatrixRows(
  rows: {
    ts_ms: number;
    matrix_type: MatrixType;
    base: string; quote: string; value: number;
    meta?: Record<string, any>;
  }[],
  appSessionId?: string | null
) {
  if (!rows.length) return;
  const sessionKey = await normalizeSessionId(appSessionId);
  const client = await db.connect();
  try {
    const values: any[] = [];
    const chunks = rows.map((r, i) => {
      const j = i * 7;
      const meta = { ...(r.meta ?? {}), app_session_id: sessionKey };
      values.push(
        r.ts_ms,
        r.matrix_type,
        r.base,
        r.quote,
        r.value,
        JSON.stringify(meta),
        sessionKey
      );
      return `($${j+1}, $${j+2}, $${j+3}, $${j+4}, $${j+5}, $${j+6}, $${j+7})`;
    }).join(",");

    const sql = `
      INSERT INTO ${TABLE} (ts_ms, matrix_type, base, quote, value, meta, app_session_id)
      VALUES ${chunks}
      ON CONFLICT (ts_ms, matrix_type, base, quote, user_key)
      DO UPDATE SET
        value = EXCLUDED.value,
        meta = EXCLUDED.meta,
        app_session_id = COALESCE(EXCLUDED.app_session_id, ${TABLE}.app_session_id);
    `;
    await client.query(sql, values);
  } finally {
    client.release();
  }
}

/** Snapshots & lookups */
export async function getLatestByType(
  matrix_type: string,
  coins: string[],
  appSessionId?: string | null
) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      `SELECT ts_ms
         FROM ${TABLE}
        WHERE matrix_type=$1
          AND coalesce(meta->>'app_session_id','global') = $2
     ORDER BY ts_ms DESC LIMIT 1`,
      [matrix_type, sessionKey]
    );
    if (!rows.length) return { ts_ms: null, values: [] as any[] };
    const ts_ms = Number(rows[0].ts_ms);
    const { rows: vals } = await client.query(
      `SELECT base, quote, value FROM ${TABLE}
       WHERE matrix_type=$1 AND ts_ms=$2 AND base = ANY($3) AND quote = ANY($3)
         AND coalesce(meta->>'app_session_id','global') = $4`,
      [matrix_type, ts_ms, coins, sessionKey]
    );
    return { ts_ms, values: vals };
  } finally { client.release(); }
}

export async function getPrevValue(
  matrix_type: string,
  base: string,
  quote: string,
  beforeTs: number,
  appSessionId?: string | null,
  client?: PoolClient | null,
) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const executor = client ? client.query.bind(client) : db.query.bind(db);
  const { rows } = await executor(
    `SELECT value FROM ${TABLE}
     WHERE matrix_type=$1 AND base=$2 AND quote=$3 AND ts_ms < $4
       AND coalesce(meta->>'app_session_id','global') = $5
     ORDER BY ts_ms DESC LIMIT 1`,
    [matrix_type, base, quote, beforeTs, sessionKey]
  );
  return rows.length ? Number(rows[0].value) : null;
}

export async function getLatestTsForType(matrix_type: string, appSessionId?: string | null, client?: PoolClient | null) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const executor = client ? client.query.bind(client) : db.query.bind(db);
  const { rows } = await executor(
    `SELECT MAX(ts_ms) AS ts_ms FROM ${TABLE}
      WHERE matrix_type=$1
        AND coalesce(meta->>'app_session_id','global') = $2`,
    [matrix_type, sessionKey]
  );
  const v = rows[0]?.ts_ms;
  return v == null ? null : Number(v);
}

export async function getNearestTsAtOrBefore(
  matrix_type: string,
  ts_ms: number,
  appSessionId?: string | null,
  client?: PoolClient | null,
) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const executor = client ? client.query.bind(client) : db.query.bind(db);
  const { rows } = await executor(
    `SELECT ts_ms FROM ${TABLE}
     WHERE matrix_type=$1 AND ts_ms <= $2
       AND coalesce(meta->>'app_session_id','global') = $3
     ORDER BY ts_ms DESC LIMIT 1`,
    [matrix_type, ts_ms, sessionKey]
  );
  const v = rows[0]?.ts_ms;
  return v == null ? null : Number(v);
}

export async function getSnapshotByType(
  matrix_type: string,
  ts_ms: number,
  coins: string[],
  appSessionId?: string | null,
  client?: PoolClient | null,
) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const executor = client ? client.query.bind(client) : db.query.bind(db);
  const { rows } = await executor(
    `SELECT base, quote, value FROM ${TABLE}
     WHERE matrix_type=$1 AND ts_ms=$2 AND base = ANY($3) AND quote = ANY($3)
       AND coalesce(meta->>'app_session_id','global') = $4`,
    [matrix_type, ts_ms, coins, sessionKey]
  );
  return rows as { base:string; quote:string; value:number }[];
}

export async function getPrevSnapshotByType(
  matrix_type: string,
  beforeTs: number,
  coins: string[],
  appSessionId?: string | null,
  client?: PoolClient | null,
) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const executor = client ? client.query.bind(client) : db.query.bind(db);
  const { rows } = await executor(
    `SELECT DISTINCT ON (base, quote) base, quote, value
        FROM ${TABLE}
       WHERE matrix_type=$1
         AND ts_ms < $2
         AND base  = ANY($3)
         AND quote = ANY($3)
         AND coalesce(meta->>'app_session_id','global') = $4
   ORDER BY base, quote, ts_ms DESC`,
    [matrix_type, beforeTs, coins, sessionKey]
  );
  return rows as { base: string; quote: string; value: number }[];
}

export async function countRowsAt(matrix_type: string, ts_ms: number, appSessionId?: string | null) {
  const sessionKey = await normalizeSessionId(appSessionId);
  const executor = db.query.bind(db);
  const { rows } = await executor(
    `SELECT count(*)::int AS n FROM ${TABLE}
      WHERE matrix_type=$1 AND ts_ms=$2
        AND coalesce(meta->>'app_session_id','global') = $3`,
    [matrix_type, ts_ms, sessionKey]
  );
  return rows[0]?.n ?? 0;
}

/** Stamp the latest benchmark slice for a session with opening_stamp=true. */
export async function stampOpeningForSession(
  appSessionId: string | null | undefined,
  targetTsMs?: number | null
): Promise<{ ok: boolean; stamped: number; tsMs: number | null }> {
  const sessionKey = await normalizeSessionId(appSessionId);
  const client = await db.connect();
  try {
    let tsMs: number | null = null;
    if (targetTsMs != null && Number.isFinite(Number(targetTsMs))) {
      tsMs = Number(targetTsMs);
    } else {
      const { rows } = await client.query<{ ts_ms: string | number | null }>(
        `SELECT max(ts_ms) AS ts_ms
           FROM ${TABLE}
          WHERE matrix_type = 'benchmark'
            AND coalesce(meta->>'app_session_id','global') = $1`,
        [sessionKey]
      );
      const raw = rows[0]?.ts_ms;
      const parsed = raw == null ? NaN : Number(raw);
      tsMs = Number.isFinite(parsed) ? parsed : null;
    }

    if (!Number.isFinite(tsMs)) {
      return { ok: false, stamped: 0, tsMs: null };
    }

    const { rowCount } = await client.query(
      `UPDATE ${TABLE}
          SET opening_stamp = true,
              opening_ts    = COALESCE(opening_ts, to_timestamp($2/1000.0))
        WHERE matrix_type = 'benchmark'
          AND ts_ms = $2
          AND coalesce(meta->>'app_session_id','global') = $1`,
      [sessionKey, tsMs]
    );
    return { ok: (rowCount ?? 0) > 0, stamped: rowCount ?? 0, tsMs };
  } finally {
    client.release();
  }
}

/** Stamp the nearest benchmark slice at/before the given snapshot ms with snapshot_stamp=true. */
export async function stampSnapshotForSession(
  appSessionId: string | null | undefined,
  snapshotMs: number | null | undefined
): Promise<{ ok: boolean; stamped: number; tsMs: number | null }> {
  const sessionKey = await normalizeSessionId(appSessionId);
  const targetMs = Number(snapshotMs);
  if (!Number.isFinite(targetMs)) {
    return { ok: false, stamped: 0, tsMs: null };
  }

  const client = await db.connect();
  try {
    const { rows } = await client.query<{ ts_ms: string | number | null }>(
      `SELECT max(ts_ms) AS ts_ms
         FROM ${TABLE}
        WHERE matrix_type = 'benchmark'
          AND ts_ms <= $2
          AND coalesce(meta->>'app_session_id','global') = $1`,
      [sessionKey, targetMs]
    );
    const raw = rows[0]?.ts_ms;
    const tsMs = Number.isFinite(Number(raw)) ? Number(raw) : null;
    if (!Number.isFinite(tsMs)) {
      return { ok: false, stamped: 0, tsMs: null };
    }

    const { rowCount } = await client.query(
      `UPDATE ${TABLE}
          SET snapshot_stamp = true,
              snapshot_ts    = to_timestamp($3/1000.0)
        WHERE matrix_type = 'benchmark'
          AND ts_ms = $2
          AND coalesce(meta->>'app_session_id','global') = $1`,
      [sessionKey, tsMs, targetMs]
    );
    return { ok: (rowCount ?? 0) > 0, stamped: rowCount ?? 0, tsMs };
  } finally {
    client.release();
  }
}

/** Legacy alias required by older API routes. */
export const pool = db;


// ───────────────────────── Opening helpers (DB + cache) ──────────────────────
type OpeningKey = { base: string; quote?: string; window?: string; appSessionId?: string };
const openingCache = new Map<string, { price: number; ts: number }>();
const keyStr = (k: OpeningKey) =>
  `${k.base}:${k.quote ?? "USDT"}:${k.window ?? "1h"}:${k.appSessionId ?? "global"}`;

/** Read last opening for a (base,quote,window,session) from STR-AUX; fallback to compat view */
export async function getOpeningFromDb(
  k: OpeningKey
): Promise<{ price: number; ts: number } | null> {
  // Source of truth: strategy_aux.str_aux_session with opening_stamp = TRUE
  const q1 = `
    SELECT opening_ts AS ts, opening_price AS price
      FROM strategy_aux.str_aux_session
     WHERE pair_base=$1 AND pair_quote=$2 AND window_key=$3
       AND ($4::text IS NULL OR app_session_id=$4)
       AND opening_stamp = TRUE
  ORDER BY opening_ts DESC
     LIMIT 1
  `;
  const r1 = await db.query(q1, [k.base, k.quote ?? "USDT", k.window ?? "1h", k.appSessionId ?? null]);
  if (r1.rows.length) {
    return { price: Number(r1.rows[0].price), ts: Number(r1.rows[0].ts) };
  }

  // Compatibility view (kept for older code paths)
  const q2 = `SELECT session_ts AS ts, opening_price AS price
                FROM session_openings
            ORDER BY session_ts DESC
               LIMIT 1`;
  const r2 = await db.query(q2);
  if (r2.rows.length) {
    return { price: Number(r2.rows[0].price), ts: Number(r2.rows[0].ts) };
  }
  return null;
}

/**
 * Ensure an opening exists + cache it for this process.
 * If you pass openingTs/openingPrice, we try to upsert via the SQL function `upsert_str_aux_opening` (if present).
 */
export async function ensureOpening(
  k: OpeningKey,
  opts: { openingTs?: number; openingPrice?: number; etaPct?: number; epsShiftPct?: number; K?: number } = {}
) {
  const ck = keyStr(k);
  const hit = openingCache.get(ck);
  if (hit) return hit;

  // If given explicit opening, try to persist (no-op if the function doesn't exist).
  if (opts.openingPrice != null && opts.openingTs != null) {
    try {
      await db.query(
        `SELECT upsert_str_aux_opening($1,$2,$3,$4,$5,$6,$7)`,
        [
          k.base, k.quote ?? "USDT", k.window ?? "1h", k.appSessionId ?? "global",
          opts.openingTs, opts.openingPrice,
          `idem:${k.base}:${k.quote ?? "USDT"}:${k.window ?? "1h"}:${k.appSessionId ?? "global"}:${opts.openingTs}`
        ]
      );
    } catch { /* function may not exist yet; it's fine */ }
  }

  const row = await getOpeningFromDb(k);
  if (row) {
    openingCache.set(ck, row);
    return row;
  }
  return null;
}

export function clearOpeningCache(k?: OpeningKey) {
  if (!k) return openingCache.clear();
  openingCache.delete(keyStr(k));
}


// ───────────────────────── Matrices STAGE/COMMIT helpers ─────────────────────
/** Grid object shape used across features (BASE -> QUOTE -> value|null) */
export type MatrixGridObject = Record<string, Record<string, number | null>>;

/** Internal: iterate off-diagonal cells that have finite numbers */
function* cellsOf(coins: string[], values: MatrixGridObject) {
  for (const b of coins) {
    for (const q of coins) {
      if (b === q) continue;
      const v = values?.[b]?.[q];
      if (v == null || Number.isNaN(Number(v))) continue;
      yield { base: b, quote: q, value: Number(v) };
    }
  }
}

/** Stage all cells for a (matrix_type, ts_ms). Overwrites on conflict in STAGE. */
export async function stageMatrixGrid(opts: {
  appSessionId: string;
  matrixType: MatrixType;
  tsMs: number;
  coins: string[];
  values: MatrixGridObject;
  meta?: any;
  openingStamp?: boolean;
  openingTs?: number | null;
  snapshotStamp?: boolean;
  snapshotTs?: number | null;
  tradeStamp?: boolean;
  tradeTs?: number | null;
  userId?: string | null;
  client?: PoolClient;
}) {
  const {
    appSessionId,
    matrixType,
    tsMs,
    coins,
    values,
    meta,
    openingStamp,
    openingTs,
    snapshotStamp,
    snapshotTs,
    tradeStamp,
    tradeTs,
    userId: userIdOverride,
    client: external,
  } = opts;
  const client = external ?? (await db.connect());
  const release = !external;
  try {
    const rows = Array.from(cellsOf(coins, values));
    if (!rows.length) return { ok: true, staged: 0 };

    const sessionKey = await normalizeSessionId(appSessionId);
    let userId =
      userIdOverride ??
      (
        await client.query<{ uid: string | null }>(
          "select nullif(current_setting('app.current_user_id', true), '') as uid"
        )
      ).rows[0]?.uid ??
      null;
    if (!userId) {
      const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidLike.test(sessionKey)) {
        userId = sessionKey;
      } else {
        const m = sessionKey.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (m) userId = m[0] ?? null;
      }
    }
    const metaObj = { ...(meta ?? {}), app_session_id: sessionKey };
    const metaJson = JSON.stringify(metaObj);
    const openStampVal = openingStamp === true;
    const openTsVal = openingTs != null ? new Date(openingTs) : null;
    const snapStampVal = snapshotStamp === true;
    const snapTsVal = snapshotTs != null ? new Date(snapshotTs) : null;
    const tradeStampVal = tradeStamp === true;
    const tradeTsVal = tradeTs != null ? new Date(tradeTs) : null;

    const stageInfo = await ensureStageInfo(client);
    const metaIdx = 3 + rows.length * 3;
    const userIdx = metaIdx + 1;
    const sessionIdx = userIdx + 1;
    const openIdx = sessionIdx + 1;
    const openTsIdx = openIdx + 1;
    const snapIdx = openTsIdx + 1;
    const snapTsIdx = snapIdx + 1;
    const tradeIdx = snapTsIdx + 1;
    const tradeTsIdx = tradeIdx + 1;
    const text = `
      INSERT INTO ${stageInfo.ident}
        (ts_ms, matrix_type, base, quote, value, meta, user_id, app_session_id, opening_stamp, opening_ts, snapshot_stamp, snapshot_ts, trade_stamp, trade_ts)
      VALUES ${rows
        .map(
          (_, i) =>
            `($1,$2,$${i * 3 + 3},$${i * 3 + 4},$${i * 3 + 5},$${metaIdx},$${userIdx},$${sessionIdx},$${openIdx},$${openTsIdx},$${snapIdx},$${snapTsIdx},$${tradeIdx},$${tradeTsIdx})`
        )
        .join(",")}
      ON CONFLICT (ts_ms, matrix_type, base, quote, user_key)
      DO UPDATE SET
        value = EXCLUDED.value,
        meta = EXCLUDED.meta,
        user_id = COALESCE(${stageInfo.ident}.user_id, EXCLUDED.user_id),
        app_session_id = EXCLUDED.app_session_id,
        opening_stamp = ${stageInfo.ident}.opening_stamp OR EXCLUDED.opening_stamp,
        opening_ts = COALESCE(${stageInfo.ident}.opening_ts, EXCLUDED.opening_ts),
        snapshot_stamp = ${stageInfo.ident}.snapshot_stamp OR EXCLUDED.snapshot_stamp,
        snapshot_ts = COALESCE(${stageInfo.ident}.snapshot_ts, EXCLUDED.snapshot_ts),
        trade_stamp = ${stageInfo.ident}.trade_stamp OR EXCLUDED.trade_stamp,
        trade_ts = COALESCE(${stageInfo.ident}.trade_ts, EXCLUDED.trade_ts)
    `;
    const params: any[] = [tsMs, matrixType];
    for (const r of rows) params.push(r.base, r.quote, r.value);
    params.push(
      metaJson,
      userId,
      sessionKey,
      openStampVal,
      openTsVal,
      snapStampVal,
      snapTsVal,
      tradeStampVal,
      tradeTsVal
    );
    await client.query(text, params);
    return { ok: true, staged: rows.length };
  } finally {
    if (release) client.release();
  }
}

/** Publish staged rows into main table + cycle_document + ledger (see DDL) */
export async function commitMatrixGrid(opts: {
  appSessionId: string;
  matrixType: MatrixType;
  tsMs: number;
  coins?: string[];
  idem?: string | null;
  client?: PoolClient;
}) {
  const { appSessionId, matrixType, tsMs, coins, client: external } = opts;
  const sessionKey = await normalizeSessionId(appSessionId);
  const client = external ?? (await db.connect());
  const release = !external;
  const manageTx = !external;
  try {
    if (manageTx) await client.query("BEGIN");

    const stageInfo = await ensureStageInfo(client);
    const matrixTable = await getMatrixValuesTableIdent(client);

    const stageRows = await client.query<{ base: string; quote: string }>(
      `SELECT base, quote
         FROM ${stageInfo.ident}
        WHERE ts_ms = $1 AND matrix_type = $2 AND app_session_id = $3`,
      [tsMs, matrixType, sessionKey]
    );

    const stagedCells = stageRows.rowCount ?? stageRows.rows.length;

    const coinsFromStage = new Set<string>();
    for (const row of stageRows.rows) {
      const base = String(row.base ?? "").toUpperCase();
      const quote = String(row.quote ?? "").toUpperCase();
      if (base) coinsFromStage.add(base);
      if (quote) coinsFromStage.add(quote);
    }

    const eligibleCoins =
      coins?.length && dedupeUpper(coins).length
        ? dedupeUpper(coins)
        : Array.from(coinsFromStage);

    const expectedCells =
      eligibleCoins.length * Math.max(eligibleCoins.length - 1, 0);

    await client.query(
      `
      INSERT INTO ${matrixTable}
        (ts_ms, matrix_type, base, quote, value, meta, user_id, app_session_id, opening_stamp, opening_ts, snapshot_stamp, snapshot_ts, trade_stamp, trade_ts)
      SELECT ts_ms, matrix_type, base, quote, value, meta, user_id, app_session_id, opening_stamp, opening_ts, snapshot_stamp, snapshot_ts, trade_stamp, trade_ts
        FROM ${stageInfo.ident}
       WHERE ts_ms = $1 AND matrix_type = $2 AND app_session_id = $3
      ON CONFLICT (ts_ms, matrix_type, base, quote, user_key)
      DO UPDATE SET
        value = EXCLUDED.value,
        meta = EXCLUDED.meta,
        user_id = COALESCE(EXCLUDED.user_id, ${matrixTable}.user_id),
        app_session_id = COALESCE(EXCLUDED.app_session_id, ${matrixTable}.app_session_id),
        opening_stamp = ${matrixTable}.opening_stamp OR EXCLUDED.opening_stamp,
        opening_ts = COALESCE(${matrixTable}.opening_ts, EXCLUDED.opening_ts),
        snapshot_stamp = ${matrixTable}.snapshot_stamp OR EXCLUDED.snapshot_stamp,
        snapshot_ts = COALESCE(${matrixTable}.snapshot_ts, EXCLUDED.snapshot_ts),
        trade_stamp = ${matrixTable}.trade_stamp OR EXCLUDED.trade_stamp,
        trade_ts = COALESCE(${matrixTable}.trade_ts, EXCLUDED.trade_ts)
    `,
      [tsMs, matrixType, sessionKey]
    );

    const stagedPairs = new Set(
      stageRows.rows
        .map((row) => {
          const base = String(row.base ?? "").toUpperCase();
          const quote = String(row.quote ?? "").toUpperCase();
          if (!base || !quote || base === quote) return null;
          return `${base}→${quote}`;
        })
        .filter(Boolean) as string[]
    );

    let missingCount = 0;
    for (const base of eligibleCoins) {
      for (const quote of eligibleCoins) {
        if (base === quote) continue;
        if (!stagedPairs.has(`${base}→${quote}`)) missingCount += 1;
      }
    }

    if (manageTx) await client.query("COMMIT");

    return {
      ok: true,
      matrix_type: matrixType,
      ts_ms: tsMs,
      expected_cells: expectedCells,
      staged_cells: stagedCells,
      missing_count: missingCount,
      complete: missingCount === 0 && stagedCells === expectedCells,
    };
  } catch (err) {
    if (manageTx) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (release) client.release();
  }
}

/** Convenience: read prev benchmark grid for a coin set (paired map) */
async function mapPrevBenchmark(beforeTs: number, coins: string[], appSessionId?: string | null) {
  const prev = await getPrevSnapshotByType("benchmark", beforeTs, coins, appSessionId);
  const m = new Map<string, number>();
  for (const r of prev) m.set(`${r.base}/${r.quote}`, Number(r.value));
  return m;
}

/**
 * Persist the current live slices for the active coin-universe:
 *  - benchmark (full N×N)
 *  - pct24h   (as-is from live)
 *  - id_pct   (derived vs prev benchmark so pct_drv has history on next tick)
 *
 * All three use the SAME ts_ms to keep slices aligned.
 */
export async function persistLiveMatricesSlice(opts: {
  appSessionId: string;
  coins: string[];
  tsMs: number;
  benchmark: MatrixGridObject;
  pct24h?: MatrixGridObject;
  idemPrefix?: string;
  openingStamp?: boolean;
  openingTs?: number;
}): Promise<{ openingStamp: boolean; openingTs: number }> {
  const {
    appSessionId,
    coins,
    tsMs,
    benchmark,
    pct24h,
    idemPrefix,
    openingStamp,
    openingTs,
  } = opts;

  const explicitMark =
    openingStamp === undefined
      ? null
      : { openingStamp: Boolean(openingStamp), openingTs: openingTs ?? tsMs };

  const sessionKey = await normalizeSessionId(appSessionId);

  return withClient(async (client) => {
    const mark =
      explicitMark ?? (await shouldStampOpeningOnce(client, appSessionId, tsMs));

    try {
      await client.query("BEGIN");

      // 1) stage+commit benchmark
      await stageMatrixGrid({
        appSessionId,
        matrixType: "benchmark",
        tsMs,
        coins,
        values: benchmark,
        meta: { source: "live" },
        openingStamp: mark.openingStamp,
        openingTs: mark.openingTs,
        client,
      });
      await commitMatrixGrid({
        appSessionId,
        matrixType: "benchmark",
        tsMs,
        coins,
        idem: `${idemPrefix ?? "benchmark"}:${tsMs}`,
        client,
      });

      // 2) stage+commit pct24h (optional)
      if (pct24h) {
        await stageMatrixGrid({
          appSessionId,
          matrixType: "pct24h",
          tsMs,
          coins,
          values: pct24h,
          meta: { source: "live" },
          openingStamp: mark.openingStamp,
          openingTs: mark.openingTs,
          client,
        });
        await commitMatrixGrid({
          appSessionId,
          matrixType: "pct24h",
          tsMs,
          coins,
          idem: `${idemPrefix ?? "pct24h"}:${tsMs}`,
          client,
        });
      }

      // 3) derive id_pct vs prev(benchmark) and persist
  const prevMap = await mapPrevBenchmark(tsMs, coins, appSessionId);
      const idObj: MatrixGridObject = {};
      for (const b of coins) {
        idObj[b] = {} as Record<string, number | null>;
        for (const q of coins) {
          if (b === q) continue;
          const now = benchmark?.[b]?.[q];
          const prev = prevMap.get(`${b}/${q}`);
          if (now == null || prev == null || Math.abs(prev) < 1e-300) {
            idObj[b][q] = null;
          } else {
            idObj[b][q] = (Number(now) - prev) / prev; // id_pct = (bm_new - bm_prev)/bm_prev
          }
        }
      }
      await stageMatrixGrid({
        appSessionId,
        matrixType: "id_pct",
        tsMs,
        coins,
        values: idObj,
        meta: { source: "derived@db", base: "prev(benchmark)" },
        openingStamp: mark.openingStamp,
        openingTs: mark.openingTs,
        client,
      });
      await commitMatrixGrid({
        appSessionId,
        matrixType: "id_pct",
        tsMs,
        coins,
        idem: `${idemPrefix ?? "id_pct"}:${tsMs}`,
        client,
      });

      await client.query("COMMIT");
      return mark;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      if (mark.openingStamp) {
        openingStampedSessions.delete(sessionKey);
      }
      throw err;
    }
  });
}

/* -------------------------------------------------------------------------- */
/*                        CLI utilities (former db.mts)                        */
/* -------------------------------------------------------------------------- */

type Step = { name: string; files: string[] };

const BASE_STEP: Step = {
  name: "BASE DDLs",
  files: [
    "00_schemas.sql",
    "01_extensions.sql",
    "02_a_ops_session_stamp.sql",
    "02_b_ops_open_guard.sql",
    "02_settings.sql",
    "03_market.sql",
    "04_documents.sql",
    "05_wallet.sql",
    "06_compat_ops.sql",
    "07_matrices.sql",
    "08_str-aux.sql",
    "09_cin-aux-core.sql",
    "10_cin-aux-runtime.sql",
    "11_cin-aux-functions.sql",
    "12_mea_dynamics.sql",
    "13_ops.sql",
    "14_views-latest.sql",
    "15_admin.sql",
    "16_ingest.sql",
    "17_units.sql",
    "18_str-aux_support.sql",
    "19_debug.sql",
    "20_cin_aux_views.sql",
    "21_auth.sql",
    "22_auth-invites.sql",
    "23_admin_action-log.sql",
    "24_audit.sql",
    "25_rls.sql",
    "26_mail.sql",
    "27_snapshot.sql",
    "28_mgmt.sql",
    "29_profile.sql",
    "30_snapshot_stamps.sql",
    "31_wallet.sql",
    "99_security.sql",
  ],
};

const PATCH_STEP: Step = {
  name: "PATCH SET v1",
  files: [],
};

const SEED_STEP: Step = { name: "SEEDS", files: ["01_seed.sql", "02_seed_jobs.sql"] };
const VERIFY_STEP: Step = { name: "VERIFY", files: ["03_verify.sql"] };

async function spawnCommand(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const { spawn } = await import("node:child_process");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

export async function runDbTool(
  argv: string[] = typeof process !== "undefined" ? process.argv.slice(2) : [],
  opts: { root?: string } = {},
): Promise<void> {
  const [{ resolve, join }, fs, dotenv] = await Promise.all([
    import("node:path"),
    import("node:fs"),
    import("dotenv"),
  ]);

  const rootTarget = opts.root ?? join("src", "core", "db", "ddl");
  const ROOT = resolve(process.cwd(), rootTarget);
  const ENV_FILE = join(ROOT, ".env.db");
  if (fs.existsSync(ENV_FILE)) {
    dotenv.config({ path: ENV_FILE });
  }

  const pg = {
    host: process.env.PGHOST ?? "localhost",
    port: String(process.env.PGPORT ?? "5432"),
    db: process.env.PGDATABASE ?? "postgres",
    user: process.env.PGUSER ?? "postgres",
    pass: process.env.PGPASSWORD ?? "",
  };

  const fileExists = (file: string) => fs.existsSync(join(ROOT, file));

  async function ensurePsql() {
    await spawnCommand("psql", ["--version"]);
  }

  async function execSql(file: string) {
    if (!fileExists(file)) return;
    const full = join(ROOT, file);
    await spawnCommand(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        pg.host,
        "-p",
        pg.port,
        "-U",
        pg.user,
        "-d",
        pg.db,
        "-f",
        full,
      ],
      { ...process.env, PGPASSWORD: pg.pass },
    );
  }

  async function runStep(step: Step) {
    console.log(`\n=== ${step.name} ===`);
    for (const file of step.files) {
      if (!fileExists(file)) continue;
      console.log(`-> ${file}`);
      await execSql(file);
    }
  }

  async function ensureDb() {
    const sql = `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${pg.db}') THEN
         EXECUTE 'CREATE DATABASE ${pg.db}';
       END IF;
     END$$;`;
    await spawnCommand(
      "psql",
      [
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        pg.host,
        "-p",
        pg.port,
        "-U",
        pg.user,
        "-d",
        "postgres",
        "-c",
        sql,
      ],
      { ...process.env, PGPASSWORD: pg.pass },
    );
  }

  function usage() {
    console.log(`
Usage:
  pnpm db:apply     # base DDLs + patches
  pnpm db:seed      # seeds (universe/timing/session/jobs)
  pnpm db:verify    # quick checks
  pnpm db:all       # ensure DB, apply, seed, verify
  pnpm db:psql      # open interactive psql to PGDATABASE

ENV: read from db/.env.db (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD)
`.trim());
  }

  const [cmd = ""] = argv;
  await ensurePsql();

  if (cmd === "apply") {
    await runStep(BASE_STEP);
    await runStep(PATCH_STEP);
    console.log("[ok] apply complete");
    return;
  }

  if (cmd === "seed") {
    await runStep(SEED_STEP);
    console.log("[ok] seed complete");
    return;
  }

  if (cmd === "verify") {
    await runStep(VERIFY_STEP);
    console.log("[ok] verify complete");
    return;
  }

  if (cmd === "all") {
    await ensureDb();
    await runStep(BASE_STEP);
    await runStep(PATCH_STEP);
    await runStep(SEED_STEP);
    await runStep(VERIFY_STEP);
    console.log("[ok] all done");
    return;
  }

  if (cmd === "psql") {
    await spawnCommand(
      "psql",
      ["-h", pg.host, "-p", pg.port, "-U", pg.user, "-d", pg.db],
      { ...process.env, PGPASSWORD: pg.pass },
    );
    return;
  }

  usage();
  throw new Error(`Unknown db command "${cmd}"`);
}

async function maybeRunDbToolFromCli() {
  if (typeof process === "undefined" || !process.argv?.[1]) return;
  try {
    const { pathToFileURL } = await import("node:url");
    if (import.meta.url !== pathToFileURL(process.argv[1]!).href) return;
  } catch {
    return;
  }

  try {
    await runDbTool(process.argv.slice(2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

void maybeRunDbToolFromCli();
