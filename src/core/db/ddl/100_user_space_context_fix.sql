-- 100_user_space_context_fix.sql
-- Harden user_space context to use app.user_id/app.session_id, add tombstones, and
-- enforce precedence for effective coin universe (session > user > global).

BEGIN;

/* Ensure tombstone columns exist (idempotent) */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'user_space'
       AND table_name   = 'session_coin_universe'
       AND column_name  = 'enabled'
  ) THEN
    ALTER TABLE user_space.session_coin_universe
      ADD COLUMN enabled boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'user_space'
       AND table_name   = 'session_coin_universe'
       AND column_name  = 'updated_at'
  ) THEN
    ALTER TABLE user_space.session_coin_universe
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END$$;

/* Canonical single-row upsert */
CREATE OR REPLACE FUNCTION user_space.upsert_session_coin_universe(
  p_session_id text,
  p_symbol     text,
  p_enabled    boolean DEFAULT true
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO user_space.session_coin_universe(session_id, symbol, enabled, updated_at)
  VALUES (p_session_id, upper(p_symbol), coalesce(p_enabled, true), now())
  ON CONFLICT (session_id, symbol) DO UPDATE
    SET enabled    = coalesce(EXCLUDED.enabled, true),
        updated_at = now();
$$;

/* Backwards-compatible bulk helper with guards (uses app.session_id/app.user_id) */
CREATE OR REPLACE FUNCTION user_space.sp_upsert_session_coin_universe(
  p_symbols    text[],
  p_enable     boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  sid text := nullif(current_setting('app.session_id', true), '');
  uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF sid IS NULL OR sid = 'global' THEN
    RAISE EXCEPTION 'user_space session_id missing or global';
  END IF;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'user_space user_id missing';
  END IF;

  INSERT INTO user_space.session_coin_universe(session_id, symbol, enabled, updated_at)
  SELECT sid, upper(s), coalesce(p_enable, true), now()
    FROM unnest(coalesce(p_symbols, '{}')) AS s
  ON CONFLICT (session_id, symbol) DO UPDATE
    SET enabled    = coalesce(EXCLUDED.enabled, true),
        updated_at = now();
END;
$$;

/* Effective universe: session overrides user overrides global; tombstones hide lower scopes */
CREATE OR REPLACE VIEW user_space.v_effective_coin_universe AS
WITH ctx AS (
  SELECT
    nullif(current_setting('app.session_id', true), '') AS session_id,
    nullif(current_setting('app.user_id', true), '')::uuid AS user_id
),
session_rows AS (
  SELECT
    1 AS precedence,
    upper(scu.symbol) AS symbol,
    scu.enabled,
    NULL::uuid AS user_id,
    coalesce(cu.sort_order, 2147483647) AS sort_order,
    upper(coalesce(cu.base_asset, (public._split_symbol(scu.symbol)).base))  AS base_asset,
    upper(coalesce(cu.quote_asset, (public._split_symbol(scu.symbol)).quote)) AS quote_asset,
    coalesce(cu.metadata, '{}'::jsonb) AS metadata
  FROM user_space.session_coin_universe scu
  JOIN ctx ON ctx.session_id = scu.session_id
  LEFT JOIN settings.coin_universe cu ON cu.symbol = scu.symbol
),
user_rows AS (
  SELECT
    2 AS precedence,
    upper(cuu.symbol) AS symbol,
    coalesce(cuu.enabled, true) AS enabled,
    cuu.user_id,
    coalesce(cuu.sort_order, 2147483647) AS sort_order,
    upper(coalesce(cuu.base_asset, (public._split_symbol(cuu.symbol)).base))  AS base_asset,
    upper(coalesce(cuu.quote_asset, (public._split_symbol(cuu.symbol)).quote)) AS quote_asset,
    coalesce(cuu.metadata, '{}'::jsonb) AS metadata
  FROM settings.coin_universe_user cuu
  JOIN ctx ON ctx.user_id = cuu.user_id
),
global_rows AS (
  SELECT
    3 AS precedence,
    upper(cu.symbol) AS symbol,
    coalesce(cu.enabled, true) AS enabled,
    NULL::uuid AS user_id,
    coalesce(cu.sort_order, 2147483647) AS sort_order,
    upper(coalesce(cu.base_asset, (public._split_symbol(cu.symbol)).base))  AS base_asset,
    upper(coalesce(cu.quote_asset, (public._split_symbol(cu.symbol)).quote)) AS quote_asset,
    coalesce(cu.metadata, '{}'::jsonb) AS metadata
  FROM settings.coin_universe cu
)
SELECT symbol, enabled, user_id, sort_order, base_asset, quote_asset, metadata
  FROM (
    SELECT DISTINCT ON (symbol)
      symbol, enabled, user_id, sort_order, base_asset, quote_asset, metadata
    FROM (
      SELECT * FROM session_rows
      UNION ALL
      SELECT * FROM user_rows
      UNION ALL
      SELECT * FROM global_rows
    ) AS all_rows
    ORDER BY symbol, precedence
  ) ranked
 WHERE enabled = true;

/* Legacy alias preserved */
CREATE OR REPLACE VIEW user_space.v_coin_universe AS
SELECT symbol, enabled, user_id, sort_order, base_asset, quote_asset, metadata
FROM user_space.v_effective_coin_universe;

COMMIT;
