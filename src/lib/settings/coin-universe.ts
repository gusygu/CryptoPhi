import { type PoolClient } from "pg";
import { query, withDbContext } from "@/core/db/db_server";
import { normalizeCoin } from "@/lib/markets/pairs";

const SORT_SENTINEL = 2_147_483_647;

export type CoinUniverseEntry = {
  symbol: string;
  base: string;
  quote: string;
  enabled: boolean;
  sortOrder: number | null;
};

export type PairUniverseEntry = {
  base: string;
  quote: string;
};

type FetchOptions = {
  onlyEnabled?: boolean;
  context?: { userId: string; sessionId: string; isAdmin?: boolean };
};

function ensureUserId(userId: string | null | undefined): string {
  const u = String(userId ?? "").trim();
  if (!u) throw new Error("userId is required for this operation");
  return u;
}

export function normalizeCoinList(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const coin = normalizeCoin(raw as string);
    if (!coin || seen.has(coin)) continue;
    seen.add(coin);
    out.push(coin);
  }
  if (!seen.has("USDT")) {
    seen.add("USDT");
    out.push("USDT");
  }
  return out;
}

export async function fetchCoinUniverseEntries(
  options: FetchOptions = {},
  client?: PoolClient | null,
): Promise<CoinUniverseEntry[]> {
  const executor = client
    ? client.query.bind(client)
    : options.context
    ? async <T>(sql: string, params?: any[]) => withDbContext(options.context!, (c) => c.query<T>(sql, params))
    : query;
  const { rows } = await executor<{
    symbol: string;
    base_asset: string | null;
    quote_asset: string | null;
    enabled: boolean | null;
    sort_order: number | null;
  }>(
    `
      select
        symbol,
        upper(coalesce(base_asset, (public._split_symbol(symbol)).base)) as base_asset,
        upper(coalesce(quote_asset, (public._split_symbol(symbol)).quote)) as quote_asset,
        coalesce(enabled, true) as enabled,
        sort_order
      from user_space.v_effective_coin_universe
      ${options.onlyEnabled ? "where coalesce(enabled, true) = true" : ""}
      order by coalesce(sort_order, $1::int), symbol
    `,
    [SORT_SENTINEL]
  );

  return rows
    .filter((row) => row.base_asset && row.quote_asset)
    .map((row) => ({
      symbol: row.symbol?.toUpperCase() ?? "",
      base: row.base_asset!.toUpperCase(),
      quote: row.quote_asset!.toUpperCase(),
      enabled: Boolean(row.enabled ?? true),
      sortOrder: row.sort_order,
    }))
    .filter((entry) => entry.symbol.length > 0);
}

/** Replace/insert per-user universe rows; optional autoDisable clears other symbols for that user. */
export async function upsertSessionCoinUniverse(
  sessionId: string,
  symbols: string[],
  opts: { enable?: boolean; context?: { userId: string; isAdmin?: boolean } } = {},
  client?: PoolClient | null,
): Promise<{ enabled: number; deleted: number; persistedSymbols: string[] }> {
  const sid = String(sessionId ?? "").trim();
  if (!sid) throw new Error("sessionId required");
  const normalized = normalizeCoinList(symbols).filter((c) => c !== "USDT");
  const syms = normalized.map((c) => `${c}USDT`);
  const enable = opts.enable ?? true;

  const run = async (c: PoolClient) => {
    const { rows } = await c.query<{ enabled_count: number; deleted_count: number }>(
      `
        with desired as (
          select unnest($2::text[]) as symbol
        ),
        upserts as (
          insert into user_space.session_coin_universe(session_id, symbol, enabled)
          select $1::text, s.symbol, $3::boolean from desired s
          on conflict (session_id, symbol) do update
            set enabled = excluded.enabled,
                updated_at = now()
          returning 1
        ),
        tombstones as (
          update user_space.session_coin_universe scu
             set enabled = false,
                 updated_at = now()
           where scu.session_id = $1
             and (
               not exists (select 1 from desired)
               or scu.symbol not in (select symbol from desired)
             )
          returning 1
        )
        select
          (select count(*) from upserts) as enabled_count,
          (select count(*) from tombstones)     as deleted_count
      `,
      [sid, syms, enable],
    );

    const { rows: persistedRows } = await c.query<{ symbol: string }>(
      `select symbol
         from user_space.session_coin_universe
        where session_id = $1
          and enabled = true
     order by symbol`,
      [sid],
    );

    return {
      enabled: rows[0]?.enabled_count ?? 0,
      deleted: rows[0]?.deleted_count ?? 0,
      persistedSymbols: persistedRows.map((r) => r.symbol.toUpperCase()),
    };
  };

  if (client) return run(client);
  const ctx = opts.context;
  if (!ctx?.userId) {
    throw new Error("db_context_required_for_session_universe");
  }
  return withDbContext(
    { userId: ctx.userId, sessionId: sid, isAdmin: ctx.isAdmin ?? false },
    async (c) => run(c),
  );
}

// Legacy helper kept for admin/global flows that still use user_id
export async function upsertUserCoinUniverse(
  userId: string,
  symbols: string[],
  opts: { enable?: boolean; autoDisable?: boolean } = {},
  client?: PoolClient | null,
): Promise<{ enabled: number; disabled: number }> {
  const uid = ensureUserId(userId);
  const normalized = normalizeCoinList(symbols).filter((c) => c !== "USDT");
  const syms = normalized.map((c) => `${c}USDT`);
  if (!syms.length) return { enabled: 0, disabled: 0 };

  const enable = opts.enable ?? true;
  const autoDisable = opts.autoDisable ?? true;

  const executor = client ? client.query.bind(client) : query;
  const { rows } = await executor<{ enabled_count: number; disabled_count: number }>(
    `
      with desired as (
        select unnest($2::text[]) as symbol
      ),
      upserts as (
        insert into settings.coin_universe_user(user_id, symbol, enabled)
        select $1::uuid, d.symbol, $3::boolean from desired d
        on conflict (user_id, symbol) do update
          set enabled = excluded.enabled,
              updated_at = now()
        returning symbol
      ),
      disables as (
        select count(*) as disabled_count
        from settings.coin_universe_user cuu
        where cuu.user_id = $1::uuid
          and $4::boolean = true
          and cuu.symbol not in (select symbol from desired)
      )
      update settings.coin_universe_user cuu
         set enabled = false,
             updated_at = now()
      from disables
      where cuu.user_id = $1::uuid
        and $4::boolean = true
        and cuu.symbol not in (select symbol from desired)
      returning (select count(*) from upserts) as enabled_count,
                (select disabled_count from disables limit 1) as disabled_count
    `,
    [uid, syms, enable, autoDisable]
  );

  const res = rows[0];
  return {
    enabled: res?.enabled_count ?? 0,
    disabled: res?.disabled_count ?? 0,
  };
}

export async function fetchPairUniversePairs(client?: PoolClient | null): Promise<PairUniverseEntry[]> {
  const executor = client ? client.query.bind(client) : query;
  try {
    const { rows } = await executor<{ base: string | null; quote: string | null }>(
      `
        select base, quote
        from matrices.v_pair_universe
      `
    );
    return rows
      .map((row) => ({
        base: row.base?.toUpperCase().trim() ?? "",
        quote: row.quote?.toUpperCase().trim() ?? "",
      }))
      .filter((row) => row.base && row.quote && row.base !== row.quote);
  } catch (err) {
    console.warn("[settings] pair universe query failed:", err);
    return [];
  }
}

export async function fetchPairUniverseCoins(client?: PoolClient | null): Promise<string[]> {
  const pairs = await fetchPairUniversePairs(client);
  if (!pairs.length) return [];

  const set = new Set<string>();
  for (const { base, quote } of pairs) {
    if (base) set.add(base);
    if (quote) set.add(quote);
  }
  if (!set.has("USDT")) set.add("USDT");
  return Array.from(set);
}

export async function fetchCoinUniverseBases(options: FetchOptions = {}, client?: PoolClient | null): Promise<string[]> {
  const entries = await fetchCoinUniverseEntries(options, client);
  const bases = entries
    .filter((entry) => (options.onlyEnabled ? entry.enabled : true))
    .map((entry) => entry.base);
  return normalizeCoinList(bases);
}

export async function syncCoinUniverseFromBases(bases: string[], client?: PoolClient | null): Promise<void> {
  const normalized = normalizeCoinList(bases);
  if (!normalized.length) return;

  const symbols = normalized
    .filter((coin) => coin !== "USDT")
    .map((coin) => `${coin}USDT`);

  if (!symbols.length) return;

  try {
    const executor = client ? client.query.bind(client) : query;
    await executor(`select settings.sp_sync_coin_universe($1::text[])`, [symbols]);
  } catch (err) {
    console.warn("[settings] sync coin universe failed:", err);
  }
}

export async function recordSettingsCookieSnapshot(
  jsonValue: string | null | undefined,
  client?: PoolClient | null,
): Promise<void> {
  if (!jsonValue) return;
  const executor = client ? client.query.bind(client) : query;
  try {
    await executor(
      `
        insert into settings.cookies(name, value, updated_at)
        values ('appSettings', $1::jsonb, now())
        on conflict (name) do update
          set value = excluded.value,
              updated_at = excluded.updated_at
      `,
      [jsonValue]
    );
  } catch (err) {
    // table might not exist yet; log once for awareness
    console.warn("[settings] cookie snapshot skipped:", err);
  }
}
