# CryptoPhi DB Cheat Sheet (Dev)

A concise developer-oriented map of the current database layout, DDL specifics, and ready‑to‑run queries. Intended for internal debugging and onboarding.

## Schemas & Core Objects

- **settings**
  - `windows`: canonical timing labels; duration_ms is generated. Unique on `(amount, unit)`.
  - `params`: engine knobs (cycles per window).
  - `coin_universe`: global symbol list (base/quote, enabled, sort_order).
  - `coin_universe_user`: per-user universe overrides (RLS via `app.current_user_id`). View `v_coin_universe_resolved` merges user overrides with globals per request.
  - `personal_time_settings`: app-session timing preferences (RLS via `app.current_session_id`).
  - `poller_state`: last run metadata for pollers (name/poller_id, status, error, duration, cursor).
  - `cookies`: optional settings snapshots.

- **market**
  - `symbols`: canonical asset symbols; populated via sync from settings.
  - `klines`: normalized candles keyed by `(symbol, window_label, open_time)`.
  - `ticker_24h`: 24h ticker snapshots.
  - `wallet_balances`: point-in-time balances; view `wallet_balances_latest` surfaces last per asset.
  - Missing in some envs: helper `market.upsert_wallet_balance(asset text, free numeric, locked numeric, meta jsonb)` used by wallet ingest.

- **matrices**
  - `dyn_values`: time series for matrix types (`benchmark`, `pct24h`, `id_pct`, `pct_drv`, `ref`, `pct_ref`, `pct_snap`, `delta`, `snap`).
  - `dyn_values_stage`: staging table for bulk commit.

- **ingest**
  - Raw ingestion layer (`kline_raw`, `ticker_raw`, cursors, jobs`).

- **str_aux**
  - Sampling tables (`samples_5s`, `samples_5s_model`, `windows`, `window_vectors`, views for ingest targets).
  - Functions: `upsert_sample_5s`, `upsert_sample_5s_model`, `sp_roll_cycle_40s`, `try_roll_window_now`, etc.

- **cin_aux / mea_dynamics / ops / admin**
  - Present for runtime jobs, snapshots, audits. See legacy docs if you need deep coverage.

## Key Views & Search Path

Default search_path set by pool bootstrap: `settings, market, docs, matrices, str_aux, cin_aux, mea_dynamics, ingest, ops, public`.

Notable views:
- `settings.v_coin_universe_resolved`: per-user + global merge of coin universe.
- `market.wallet_balances_latest`: last balance per asset.
- `vitals.*`: health views defined in `15_admin.sql` (latest runs, wallets, object counts, etc.).

## Permissions & Context

- RLS:
  - `settings.coin_universe_user`: row visibility requires `app.current_user_id` = row.user_id.
  - `settings.personal_time_settings`: scoped by `app.current_session_id` with a `global` row.
- Pool bootstrap sets:
  - `app.current_session_id`
  - `app.current_user_id`
  - Search path and time zone per connection.

## Queries (copy/paste)

### 1) Resolve current user’s universe (with fallback)
```sql
SELECT symbol, base_asset AS base, quote_asset AS quote, enabled, sort_order
FROM settings.v_coin_universe_resolved
WHERE COALESCE(enabled, true) = true
ORDER BY COALESCE(sort_order, 2147483647), symbol;
```

### 2) Latest matrices stamp (benchmark + pct24h cell counts)
```sql
WITH latest_ts AS (
  SELECT MAX(ts_ms) AS ts FROM matrices.dyn_values WHERE matrix_type = 'benchmark'
)
SELECT dv.matrix_type, COUNT(*) AS cells
FROM matrices.dyn_values dv, latest_ts
WHERE dv.ts_ms = latest_ts.ts
  AND dv.matrix_type IN ('benchmark','pct24h')
GROUP BY dv.matrix_type;
```

### 3) STR-AUX freshness per symbol (5s samples)
```sql
SELECT symbol,
       MAX(ts) AS last_ts,
       EXTRACT(EPOCH FROM (NOW() - MAX(ts)))::int AS age_sec,
       COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '1 hour') AS rows_last_hour
FROM str_aux.samples_5s
GROUP BY symbol
ORDER BY age_sec NULLS LAST;
```

### 4) Wallet balances latest snapshot
```sql
SELECT asset, ts, free_amt, locked_amt, total_amt, meta
FROM market.wallet_balances_latest
ORDER BY asset;
```

### 5) Poller state (system refresh telemetry)
```sql
SELECT poller_id AS name, last_run_at, last_status, last_error, duration_ms, cursor, updated_at
FROM settings.poller_state
ORDER BY updated_at DESC;
```

### 6) Missing helper creation (if not present)
```sql
-- Wallet upsert helper
CREATE OR REPLACE FUNCTION market.upsert_wallet_balance(
  p_asset text, p_free numeric, p_locked numeric, p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO market.wallet_balances(asset, ts, free_amt, locked_amt, meta)
  VALUES (UPPER(p_asset), NOW(), p_free, p_locked, COALESCE(p_meta, '{}'::jsonb));
END$$;
```

## What’s Present vs Missing (common gaps)

- Present in repo DDL: `coin_universe_user` + `v_coin_universe_resolved`, `poller_state`, `wallet_balances`, matrices + str_aux tables.
- Often missing in deployed DBs (check/apply):
  - `settings.poller_state` table (used by `/api/system/refresh`).
  - `market.upsert_wallet_balance(...)` function (used by wallet ingest/persist).
  - New per-user universe objects (`coin_universe_user`, `v_coin_universe_resolved`) if the latest DDL hasn’t been applied.

## Migration Checklist

1) Apply `02_settings.sql` (adds `coin_universe_user`, merged view, RLS) and ensure `poller_state` exists.
2) Apply wallet helper: `market.upsert_wallet_balance`.
3) Run `15_admin.sql` (or ensure `market.wallet_balances` exists) if balances are needed.
4) Verify search_path + GUCs (`app.current_user_id`, `app.current_session_id`) in pool bootstrap are active.

## Debug Tips

- Set context manually to see per-user rows:
```sql
SELECT set_config('app.current_user_id', '<user-uuid>', true);
SELECT * FROM settings.v_coin_universe_resolved WHERE enabled = true;
```
- If `/api/system/refresh` fails, check `settings.poller_state` existence and DB errors in logs.
- If wallet persistence fails, confirm `market.upsert_wallet_balance` exists and `wallet_balances` table is present.

