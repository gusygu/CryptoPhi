import { query } from "@/core/db/db_server";
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

export async function fetchCoinUniverseEntries(options: FetchOptions = {}): Promise<CoinUniverseEntry[]> {
  try {
    const { rows } = await query<{
      symbol: string;
      base: string | null;
      quote: string | null;
      enabled: boolean | null;
      sort_order: number | null;
    }>(
      `
        with ctx as (
          select nullif(current_setting('app.current_user_id', true), '')::uuid as user_id
        ),
        merged as (
          -- user-specific overrides
          select
            cuu.symbol,
            cuu.base_asset,
            cuu.quote_asset,
            cuu.enabled,
            cuu.sort_order
          from settings.coin_universe_user cuu, ctx
          where ctx.user_id is not null
            and cuu.user_id = ctx.user_id

          union all

          -- global defaults for symbols not overridden by user
          select
            cg.symbol,
            cg.base_asset,
            cg.quote_asset,
            cg.enabled,
            cg.sort_order
          from settings.coin_universe cg
          where not exists (
            select 1
            from settings.coin_universe_user cuu, ctx
            where ctx.user_id is not null
              and cuu.user_id = ctx.user_id
              and cuu.symbol = cg.symbol
          )
        )
        select
          symbol,
          upper(coalesce(base_asset, (public._split_symbol(symbol)).base)) as base,
          upper(coalesce(quote_asset, (public._split_symbol(symbol)).quote)) as quote,
          coalesce(enabled, true) as enabled,
          sort_order
        from merged
        ${options.onlyEnabled ? "where coalesce(enabled, true) = true" : ""}
        order by coalesce(sort_order, $1::int), symbol
      `,
      [SORT_SENTINEL]
    );

    return rows
      .filter((row) => row.base && row.quote)
      .map((row) => ({
        symbol: row.symbol?.toUpperCase() ?? "",
        base: row.base!.toUpperCase(),
        quote: row.quote!.toUpperCase(),
        enabled: Boolean(row.enabled ?? true),
        sortOrder: row.sort_order,
      }))
      .filter((entry) => entry.symbol.length > 0);
  } catch (err) {
    console.warn("[settings] coin universe query failed:", err);
    return [];
  }
}

/** Replace/insert per-user universe rows; optional autoDisable clears other symbols for that user. */
export async function upsertUserCoinUniverse(
  userId: string,
  symbols: string[],
  opts: { enable?: boolean; autoDisable?: boolean } = {}
): Promise<{ enabled: number; disabled: number }> {
  const uid = ensureUserId(userId);
  const normalized = normalizeCoinList(symbols).filter((c) => c !== "USDT");
  const syms = normalized.map((c) => `${c}USDT`);
  if (!syms.length) return { enabled: 0, disabled: 0 };

  const enable = opts.enable ?? true;
  const autoDisable = opts.autoDisable ?? true;

  const { rows } = await query<{ enabled_count: number; disabled_count: number }>(
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

export async function fetchPairUniversePairs(): Promise<PairUniverseEntry[]> {
  try {
    const { rows } = await query<{ base: string | null; quote: string | null }>(
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

export async function fetchPairUniverseCoins(): Promise<string[]> {
  const pairs = await fetchPairUniversePairs();
  if (!pairs.length) return [];

  const set = new Set<string>();
  for (const { base, quote } of pairs) {
    if (base) set.add(base);
    if (quote) set.add(quote);
  }
  if (!set.has("USDT")) set.add("USDT");
  return Array.from(set);
}

export async function fetchCoinUniverseBases(options: FetchOptions = {}): Promise<string[]> {
  const entries = await fetchCoinUniverseEntries(options);
  const bases = entries
    .filter((entry) => (options.onlyEnabled ? entry.enabled : true))
    .map((entry) => entry.base);
  return normalizeCoinList(bases);
}

export async function syncCoinUniverseFromBases(bases: string[]): Promise<void> {
  const normalized = normalizeCoinList(bases);
  if (!normalized.length) return;

  const symbols = normalized
    .filter((coin) => coin !== "USDT")
    .map((coin) => `${coin}USDT`);

  if (!symbols.length) return;

  try {
    await query(`select settings.sp_sync_coin_universe($1::text[])`, [symbols]);
  } catch (err) {
    console.warn("[settings] sync coin universe failed:", err);
  }
}

export async function recordSettingsCookieSnapshot(jsonValue: string | null | undefined): Promise<void> {
  if (!jsonValue) return;
  try {
    await query(
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
