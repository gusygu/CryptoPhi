import { randomUUID } from "crypto";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getServerRequestContext } from "@/lib/server/request-context";
import { getAppSessionId, registerAppSessionBoot } from "@/core/system/appSession";

/**
 * Unified PG pool + convenience helpers + lightweight ledgers.
 * This replaces the old pool/server/ledger trio with a single source of truth.
 */

/* ──────────────── Environment helpers ──────────────── */
function asBool(v: unknown, fallback = false): boolean {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/* ──────────────── Pool configuration ──────────────── */
const useUrl = !!process.env.DATABASE_URL;
const baseConfig = useUrl
  ? { connectionString: String(process.env.DATABASE_URL) }
  : {
      host: String(process.env.PGHOST ?? "localhost"),
      port: Number(process.env.PGPORT ?? 1027),
      user: String(process.env.PGUSER ?? "postgres"),
      password: String(process.env.PGPASSWORD ?? "HwZ"),
      database: String(process.env.PGDATABASE ?? "cryptophi"),
    };

const poolConfig = {
  ...baseConfig,
  max: Number(process.env.DB_POOL_MAX ?? process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_MS ?? 45_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS ?? 5_000),
  ssl: asBool(process.env.DB_SSL ?? process.env.PGSSL)
    ? { rejectUnauthorized: false as const }
    : undefined,
};

const SESSION_STATEMENT_TIMEOUT = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000);
const SESSION_IDLE_TX_TIMEOUT = Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 15_000);
const SESSION_TZ = String(process.env.DB_TIMEZONE ?? "UTC").replace(/'/g, "''");
const SESSION_ID = getAppSessionId();
export const DEFAULT_SEARCH_PATH = [
  "settings",
  "market",
  "docs",
  "matrices",
  "str_aux",
  "cin_aux",
  "mea_dynamics",
  "ingest",
  "ops",
  "public",
].join(", ");

/* ──────────────── Pool singleton ──────────────── */
declare global {
   
  var __core_pg_pool__: Pool | undefined;
}

const CLIENT_CTX_PROP = Symbol("cp_request_ctx");
const CLIENT_TX_CTX = Symbol("cp_tx_ctx");
type ContextAwareClient = PoolClient & { [CLIENT_CTX_PROP]?: string };
type TxAwareClient = PoolClient & { [CLIENT_TX_CTX]?: { requestId: string; depth: number } };
const SHOULD_LOG_CTX =
  process.env.DB_CTX_LOG === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.DB_CTX_LOG !== "0");

function ensurePool(): Pool {
  if (!global.__core_pg_pool__) {
    const pool = new Pool(poolConfig as any);
    void registerAppSessionBoot().catch(() => {});
    pool.on("connect", (client: PoolClient) => {
      const bootstrap = [
        `SET statement_timeout = ${SESSION_STATEMENT_TIMEOUT}`,
        `SET idle_in_transaction_session_timeout = ${SESSION_IDLE_TX_TIMEOUT}`,
        `SET TIME ZONE '${SESSION_TZ}'`,
        `SET search_path = ${DEFAULT_SEARCH_PATH}`,
      ];
      for (const statement of bootstrap) {
        void client.query(statement).catch(() => {
          /* ignore bootstrap failures so the pool stays usable */
        });
      }
      void client
        .query("select set_config('app.current_session_id', $1, true)", [SESSION_ID])
        .catch(() => {
          /* if the GUC isn't defined yet we still keep the connection alive */
        });
    });
    patchPoolQuery(pool);
    global.__core_pg_pool__ = pool;
  }
  return global.__core_pg_pool__!;
}

export function getPool(): Pool {
  return ensurePool();
}
export function getDb(): Pool {
  return ensurePool();
}

export type RequestContextOverride = {
  userId?: string | null;
  sessionId?: string | null;
  isAdmin?: boolean;
};

async function applyRequestContext(client: PoolClient, override?: RequestContextOverride) {
  const ctx = override ?? getServerRequestContext() ?? { userId: null, sessionId: null, isAdmin: false };
  let userId = ctx.userId ?? null;
  const sessionId = ctx.sessionId ?? null;
  const isAdmin = ctx.isAdmin ?? false;
  const path = (ctx as any)?.path ?? null;
  const badgeParam = (ctx as any)?.badgeParam ?? null;
  let resolvedFromSessionMap = (ctx as any)?.resolvedFromSessionMap ?? false;

  if (userId && !sessionId) {
    throw new Error("missing_session_badge");
  }

  // Resolve user from session_map when only a badge is present.
  if (!userId && sessionId) {
    try {
      const { rows } = await client.query<{ user_id: string | null }>(
        `select auth.resolve_user_id_from_session($1) as user_id`,
        [sessionId],
      );
      if (rows[0]?.user_id) {
        userId = rows[0].user_id;
        resolvedFromSessionMap = true;
      }
    } catch {
      /* ignore lookup failures; will stay anonymous */
    }
  }

  const effectiveSession = sessionId ?? (userId ? null : SESSION_ID);
  const targetKey =
    (userId || isAdmin)
      ? `${userId ?? ""}|${isAdmin ? "1" : "0"}|${effectiveSession ?? ""}`
      : `__anon__|${effectiveSession ?? ""}`;
  const contextual = client as ContextAwareClient;
  if (contextual[CLIENT_CTX_PROP] === targetKey) {
    return;
  }

  await client.query("BEGIN");
  const calledSetRequestContext = true;
  try {
    await client.query("select auth.set_request_context($1,$2,$3)", [
      userId,
      isAdmin,
      effectiveSession,
    ]);

    const { rows } = await client.query<{ sid: string | null; uid: string | null }>(
      `select nullif(current_setting('app.current_session_id', true), '') as sid,
              nullif(current_setting('app.current_user_id', true), '')   as uid`
    );
    const sid = rows[0]?.sid ?? null;
    const uid = rows[0]?.uid ?? null;

    if (userId && !sid) {
      throw new Error("db_context_missing_session_id");
    }
    if (userId && !uid) {
      throw new Error("db_context_missing_user_id");
    }
    if (userId && effectiveSession) {
      await client.query("select user_space.ensure_session_coin_universe_bootstrapped()");
    }

    if (SHOULD_LOG_CTX) {
      try {
        const log = {
          tag: "db_request_context",
          userId,
          sessionId: effectiveSession,
          badge: effectiveSession,
          path,
          badgeParam,
          resolvedFromSessionMap,
          calledSetRequestContext,
          dbSeen: { sessionId: sid, userId: uid },
        };
        console.debug(JSON.stringify(log));
      } catch {
        /* best-effort logging */
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  }

  contextual[CLIENT_CTX_PROP] = targetKey;
}

export type DbContext = {
  userId: string;
  sessionId: string;
  isAdmin?: boolean;
  path?: string;
  badgeParam?: string | null;
  resolvedFromSessionMap?: boolean;
};

type DbContextMeta = {
  requestId: string;
  dbSeen: { userId: string | null; sessionId: string | null; pid: number | null; txid: string | null; now: string };
};

function normalizeContext(ctx: DbContext): { userId: string; sessionId: string; isAdmin: boolean } {
  const userId = String(ctx.userId ?? "").trim();
  const sessionId = String(ctx.sessionId ?? "").trim();
  if (!userId) throw new Error("db_context_missing_user_id");
  if (!sessionId) throw new Error("db_context_missing_session_id");
  if (sessionId === "global") throw new Error("db_context_global_for_user_space");
  return { userId, sessionId, isAdmin: !!ctx.isAdmin };
}

async function setLocalDbContext(
  client: PoolClient,
  ctx: DbContext,
  requestId: string,
): Promise<DbContextMeta> {
  const { userId, sessionId, isAdmin } = normalizeContext(ctx);
  const txClient = client as TxAwareClient;

  // reuse a transaction if caller already opened one via this helper
  const existing = txClient[CLIENT_TX_CTX];
  if (!existing) {
    await client.query("BEGIN");
    txClient[CLIENT_TX_CTX] = { requestId, depth: 1 };
  } else {
    existing.depth += 1;
  }

  await client.query(
    `select
       set_config('app.user_id', $1, true),
       set_config('app.session_id', $2, true),
       set_config('app.request_id', $3, true),
       set_config('app.is_admin', $4, true),
       -- legacy aliases (kept for compatibility)
       set_config('app.current_user_id', $1, true),
       set_config('app.current_session_id', $2, true),
       set_config('app.current_request_id', $3, true),
       set_config('app.current_is_admin', $4, true)
     `,
    [userId, sessionId, requestId, isAdmin ? "true" : "false"],
  );

  const { rows } = await client.query<{
    user_id: string | null;
    session_id: string | null;
    pid: number | null;
    txid: string | null;
    now: string;
  }>(
    `select
       nullif(current_setting('app.user_id', true), '') as user_id,
       nullif(current_setting('app.session_id', true), '') as session_id,
       pg_backend_pid() as pid,
       txid_current_if_assigned() as txid,
       now()::text as now`,
  );
  const dbSeen = rows[0] ?? {
    user_id: null,
    session_id: null,
    pid: null,
    txid: null,
    now: "",
  };

  if (dbSeen.user_id !== userId || dbSeen.session_id !== sessionId) {
    throw new Error(
      `db_context_mismatch: expected (${userId}, ${sessionId}) got (${dbSeen.user_id}, ${dbSeen.session_id})`,
    );
  }

  if (SHOULD_LOG_CTX) {
    try {
      const log = {
        tag: "db_request_context",
        path: ctx.path ?? null,
        badge: ctx.sessionId,
        badgeParam: ctx.badgeParam ?? null,
        effective: ctx.sessionId,
        userId,
        dbSeen: {
          userId: dbSeen.user_id,
          sessionId: dbSeen.session_id,
          pid: dbSeen.pid,
          txid: dbSeen.txid,
          now: dbSeen.now,
        },
        resolvedFromSessionMap: ctx.resolvedFromSessionMap ?? false,
        requestId,
      };
      console.info(JSON.stringify(log));
    } catch {
      /* logging is best-effort */
    }
  }

  return {
    requestId,
    dbSeen: {
      userId: dbSeen.user_id,
      sessionId: dbSeen.session_id,
      pid: dbSeen.pid,
      txid: dbSeen.txid,
      now: dbSeen.now,
    },
  };
}

async function finishLocalTx(client: PoolClient, hadError: boolean) {
  const txClient = client as TxAwareClient;
  const ctx = txClient[CLIENT_TX_CTX];
  if (!ctx) return;
  ctx.depth -= 1;
  if (ctx.depth > 0) return;
  txClient[CLIENT_TX_CTX] = undefined;
  try {
    if (hadError) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
  } catch {
    /* swallow commit/rollback errors to avoid masking original */
  }
}

export async function withDbContext<T>(
  ctx: DbContext,
  fn: (client: PoolClient, meta: DbContextMeta) => Promise<T>,
): Promise<T> {
  const client = await ensurePool().connect();
  let meta: DbContextMeta | null = null;
  let err: unknown;
  try {
    const requestId = randomUUID();
    meta = await setLocalDbContext(client, ctx, requestId);
    const result = await fn(client, meta);
    await finishLocalTx(client, false);
    return result;
  } catch (e) {
    err = e;
    await finishLocalTx(client, true);
    throw e;
  } finally {
    client.release();
  }
}

function patchPoolQuery(pool: Pool) {
  const originalQuery = pool.query;
  pool.query = (async (text: any, params?: any) => {
    return withClient((client) => client.query(text, params));
  }) as typeof originalQuery;
}

/* ──────────────── Query helpers ──────────────── */

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
export async function withClient<T>(
  ctx: RequestContextOverride | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T>;
export async function withClient<T>(
  ctxOrFn: RequestContextOverride | ((client: PoolClient) => Promise<T>) | undefined,
  maybeFn?: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const hasExplicitCtx =
    typeof ctxOrFn === "object" || ctxOrFn === undefined || ctxOrFn === null;
  const ctx = hasExplicitCtx ? (ctxOrFn as RequestContextOverride | undefined) : undefined;
  const fn = (hasExplicitCtx ? maybeFn : ctxOrFn) as
    | ((client: PoolClient) => Promise<T>)
    | undefined;

  if (typeof fn !== "function") {
    throw new Error("withClient requires a callback");
  }

  const client = await ensurePool().connect();
  try {
    await applyRequestContext(client, ctx);
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[],
  ctx?: RequestContextOverride,
): Promise<QueryResult<T>> {
  return withClient(ctx, (client) => client.query<T>(text, params));
}

export const db: Pool = ensurePool();
export const serverDb = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]) {
    return ensurePool().query<T>(text, params);
  },
};

/* ──────────────── Table constants ──────────────── */
export const TABLES = {
  matrices: process.env.MATRIX_TABLE || "matrices.dyn_values",
  matricesStage: process.env.MATRIX_STAGE_TABLE || "matrices.dyn_values_stage",
  ledger: process.env.APP_LEDGER_TABLE || "ops.app_ledger",
  transfers: process.env.TRANSFER_LEDGER_TABLE || "ops.transfer_ledger",
} as const;

/* ──────────────── Ledger helpers ──────────────── */
export type AppLedgerEvent = {
  topic: string;              // e.g. "pipeline"
  event: string;              // e.g. "dyn_matrix_upsert"
  payload?: unknown;
  session_id?: string;
  idempotency_key?: string;
  ts_epoch_ms: number;
};

/** Safe insert; ignores missing table or duplicate key. */
export async function appendAppLedger(e: AppLedgerEvent): Promise<void> {
  const sql = `
    INSERT INTO ${TABLES.ledger}
      (topic, event, payload, session_id, idempotency_key, ts_epoch_ms)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (idempotency_key) DO NOTHING
  `;
  try {
    await query(sql, [
      e.topic,
      e.event,
      e.payload ?? null,
      e.session_id ?? null,
      e.idempotency_key ?? null,
      e.ts_epoch_ms,
    ]);
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn("appendAppLedger: ledger table missing (ops.app_ledger). Skipping log.");
      return;
    }
    throw err;
  }
}

export async function getAppLedgerSince(sinceMs: number, topic?: string) {
  try {
    const { rows } = await query(
      `SELECT * FROM ${TABLES.ledger}
        WHERE ts_epoch_ms >= $1
          AND ($2::text IS NULL OR topic = $2)
     ORDER BY ts_epoch_ms ASC`,
      [sinceMs, topic ?? null],
    );
    return rows;
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn("getAppLedgerSince: ledger table missing (ops.app_ledger).");
      return [];
    }
    throw err;
  }
}

/* ──────────────── Transfer ledger helpers ──────────────── */
export async function appendTransferLedger(row: {
  app_session_id: string;
  cycle_ts: number;
  leg_seq: number;
  route_id?: string | null;
  intent_id?: string | null;
  from_symbol: string;
  to_symbol: string;
  qty_from: number;
  qty_to: number;
  price_from_usdt: number;
  price_to_usdt: number;
  fee_usdt?: number;
  exec_ts: number;
  tx_id?: string | null;
}): Promise<void> {
  const q = `
    INSERT INTO ${TABLES.transfers} (
      app_session_id, cycle_ts, leg_seq, route_id, intent_id,
      from_symbol, to_symbol, qty_from, qty_to,
      price_from_usdt, price_to_usdt, fee_usdt, exec_ts, tx_id
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,0),$13,$14
    )
    ON CONFLICT (app_session_id, cycle_ts, leg_seq) DO NOTHING
  `;
  try {
    await query(q, [
      row.app_session_id,
      row.cycle_ts,
      row.leg_seq,
      row.route_id ?? null,
      row.intent_id ?? null,
      row.from_symbol,
      row.to_symbol,
      row.qty_from,
      row.qty_to,
      row.price_from_usdt,
      row.price_to_usdt,
      row.fee_usdt ?? 0,
      row.exec_ts,
      row.tx_id ?? null,
    ]);
  } catch (err: any) {
    if (err?.code === "42P01") {
      console.warn("appendTransferLedger: transfer_ledger table missing (ops.transfer_ledger).");
      return;
    }
    throw err;
  }
}

export async function listTransferLegs(
  app_session_id: string,
  opts?: { before?: number; limit?: number },
) {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.transfers}
      WHERE app_session_id = $1
        AND ($2::bigint IS NULL OR cycle_ts < $2)
   ORDER BY cycle_ts DESC, leg_seq DESC
      LIMIT $3`,
    [app_session_id, opts?.before ?? null, opts?.limit ?? 200],
  );
  return rows;
}

export type { Pool, PoolClient, QueryResult, QueryResultRow };
