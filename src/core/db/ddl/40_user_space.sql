-- 40_user_space.sql
-- Per-user configuration surface (user_space schema) for UI-adjustable settings
-- (coin universe overrides, poller time, per-user params). Keys/permissions are excluded.

BEGIN;

CREATE SCHEMA IF NOT EXISTS user_space;

-- Helper: current user/session context
CREATE OR REPLACE VIEW user_space.v_current_user AS
SELECT
  nullif(current_setting('app.current_user_id', true), '')::uuid AS user_id,
  nullif(current_setting('app.current_session_id', true), '')    AS app_session_id;

/* -------------------------------------------------------------------------- */
/* A) Coin universe overrides (per-session first, then user, then global)     */
/* -------------------------------------------------------------------------- */

-- Session-scoped overrides
CREATE TABLE IF NOT EXISTS user_space.session_coin_universe (
  session_id text NOT NULL,
  symbol     text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_coin_universe_pkey PRIMARY KEY (session_id, symbol)
);

ALTER TABLE user_space.session_coin_universe ENABLE ROW LEVEL SECURITY;
DO $pol$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'user_space'
      AND tablename = 'session_coin_universe'
      AND policyname = 'session_coin_universe_owned'
  ) THEN
    CREATE POLICY session_coin_universe_owned ON user_space.session_coin_universe
      USING (
        session_id = nullif(current_setting('app.current_session_id', true), '')
        AND EXISTS (
          SELECT 1 FROM user_space.session_map sm
           WHERE sm.session_id = user_space.session_coin_universe.session_id
             AND sm.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        )
      )
      WITH CHECK (
        session_id = nullif(current_setting('app.current_session_id', true), '')
        AND EXISTS (
          SELECT 1 FROM user_space.session_map sm
           WHERE sm.session_id = user_space.session_coin_universe.session_id
             AND sm.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        )
      );
  END IF;
END
$pol$;

-- Legacy per-user view (still used for admin/global)
CREATE OR REPLACE VIEW user_space.v_coin_universe_user AS
SELECT *
FROM settings.coin_universe_user cuu
WHERE cuu.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid;

-- Canonical: session-scoped universe or global fallback
CREATE OR REPLACE VIEW user_space.v_effective_coin_universe AS
WITH ctx AS (
  SELECT nullif(current_setting('app.current_session_id', true), '') AS session_id
),
session_rows AS (
  SELECT
    upper(scu.symbol) AS symbol,
    coalesce(scu.enabled, true) AS enabled,
    NULL::uuid AS user_id,
    coalesce(cu.sort_order, 2147483647) AS sort_order,
    upper(coalesce(cu.base_asset, (public._split_symbol(scu.symbol)).base))  AS base_asset,
    upper(coalesce(cu.quote_asset, (public._split_symbol(scu.symbol)).quote)) AS quote_asset,
    '{}'::jsonb AS metadata
  FROM user_space.session_coin_universe scu
  JOIN ctx ON ctx.session_id = scu.session_id
  LEFT JOIN settings.coin_universe cu ON cu.symbol = scu.symbol
),
session_present AS (
  SELECT COUNT(*) AS cnt FROM session_rows
)
SELECT symbol, enabled, user_id, sort_order, base_asset, quote_asset, metadata
  FROM session_rows
UNION ALL
SELECT
  upper(cu.symbol) AS symbol,
  coalesce(cu.enabled, true) AS enabled,
  NULL::uuid AS user_id,
  cu.sort_order,
  upper(coalesce(cu.base_asset, (public._split_symbol(cu.symbol)).base))  AS base_asset,
  upper(coalesce(cu.quote_asset, (public._split_symbol(cu.symbol)).quote)) AS quote_asset,
  coalesce(cu.metadata, '{}'::jsonb) AS metadata
FROM settings.coin_universe cu, session_present sp
WHERE sp.cnt = 0;

-- Legacy alias for callers still targeting the old name
CREATE OR REPLACE VIEW user_space.v_coin_universe AS
SELECT symbol, enabled, user_id, sort_order, base_asset, quote_asset, metadata
FROM user_space.v_effective_coin_universe;

-- Upsert helper into session-scoped universe
CREATE OR REPLACE FUNCTION user_space.sp_upsert_session_coin_universe(
  p_symbols    text[],
  p_enable     boolean DEFAULT true
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO user_space.session_coin_universe(session_id, symbol, enabled, updated_at)
  SELECT coalesce(nullif(current_setting('app.current_session_id', true), ''), 'global'),
         s, coalesce(p_enable, true), now()
    FROM unnest(coalesce(p_symbols, '{}')) AS s
  ON CONFLICT (session_id, symbol) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        updated_at = now();
$$;

-- Legacy user-based upsert (kept for admin/global flows)
CREATE OR REPLACE FUNCTION user_space.sp_upsert_coin_universe(
  p_symbol      text,
  p_enabled     boolean DEFAULT true,
  p_sort_order  integer DEFAULT NULL,
  p_base_asset  text DEFAULT NULL,
  p_quote_asset text DEFAULT NULL,
  p_metadata    jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO settings.coin_universe_user(user_id, symbol, enabled, sort_order, base_asset, quote_asset, metadata)
  VALUES (
    nullif(current_setting('app.current_user_id', true), '')::uuid,
    p_symbol,
    coalesce(p_enabled, true),
    p_sort_order,
    p_base_asset,
    p_quote_asset,
    coalesce(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (user_id, symbol) DO UPDATE
    SET enabled     = coalesce(EXCLUDED.enabled, settings.coin_universe_user.enabled),
        sort_order  = coalesce(EXCLUDED.sort_order, settings.coin_universe_user.sort_order),
        base_asset  = coalesce(EXCLUDED.base_asset, settings.coin_universe_user.base_asset),
        quote_asset = coalesce(EXCLUDED.quote_asset, settings.coin_universe_user.quote_asset),
        metadata    = coalesce(EXCLUDED.metadata, settings.coin_universe_user.metadata),
        updated_at  = now();
$$;

/* -------------------------------------------------------------------------- */
/* B) Poller time settings (per session/user)                                 */
/* -------------------------------------------------------------------------- */

-- View of poller time for current session (or global)
CREATE OR REPLACE VIEW user_space.v_poller_time AS
SELECT
  pts.app_session_id,
  pts.cycle_seconds,
  pts.sampling_seconds,
  pts.window_seconds,
  pts.meta,
  pts.updated_at
FROM settings.personal_time_settings pts
WHERE pts.app_session_id IN (
  nullif(current_setting('app.current_session_id', true), ''),
  'global'
);

-- Upsert helper into settings.personal_time_settings
CREATE OR REPLACE FUNCTION user_space.sp_upsert_poller_time(
  p_cycle_seconds    int,
  p_sampling_seconds int DEFAULT NULL,
  p_window_seconds   int DEFAULT NULL,
  p_meta             jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO settings.personal_time_settings(app_session_id, cycle_seconds, sampling_seconds, window_seconds, meta, updated_at)
  VALUES (
    coalesce(nullif(current_setting('app.current_session_id', true), ''), 'global'),
    greatest(1, p_cycle_seconds),
    p_sampling_seconds,
    p_window_seconds,
    coalesce(p_meta, '{}'::jsonb),
    now()
  )
  ON CONFLICT (app_session_id) DO UPDATE
    SET cycle_seconds    = greatest(1, EXCLUDED.cycle_seconds),
        sampling_seconds = EXCLUDED.sampling_seconds,
        window_seconds   = EXCLUDED.window_seconds,
        meta             = EXCLUDED.meta,
        updated_at       = now();
$$;

/* -------------------------------------------------------------------------- */
/* C) Per-user params (overrides)                                             */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS user_space.params (
  user_id             uuid PRIMARY KEY,
  primary_interval_ms int     NOT NULL DEFAULT 30000,
  secondary_enabled   boolean NOT NULL DEFAULT false,
  secondary_cycles    int     NOT NULL DEFAULT 3,
  str_cycles_m30      int     NOT NULL DEFAULT 45,
  str_cycles_h1       int     NOT NULL DEFAULT 90,
  str_cycles_h3       int     NOT NULL DEFAULT 270,
  epsilon             numeric(12,6),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

/* -------------------------------------------------------------------------- */
/* D) Session map (short session_id -> user_id)                               */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS user_space.session_map (
  session_id   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_session_map_user ON user_space.session_map(user_id);

CREATE OR REPLACE FUNCTION user_space.sp_upsert_session_map(
  p_session_id text,
  p_user_id    uuid
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO user_space.session_map(session_id, user_id, created_at, last_seen_at)
  VALUES (p_session_id, p_user_id, now(), now())
  ON CONFLICT (session_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        last_seen_at = now();
$$;

ALTER TABLE user_space.session_map ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'user_space'
       AND tablename = 'session_map'
       AND policyname = 'session_map_owner'
  ) THEN
    CREATE POLICY session_map_owner ON user_space.session_map
      FOR ALL
      USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
  END IF;
END$$;

ALTER TABLE user_space.params ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'user_space' AND tablename = 'params' AND policyname = 'user_params_owner'
  ) THEN
    EXECUTE $q$
      CREATE POLICY user_params_owner ON user_space.params
      FOR ALL
      USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
    $q$;
  END IF;
END$$;

CREATE OR REPLACE FUNCTION user_space.sp_upsert_params(
  p_primary_interval_ms int DEFAULT 30000,
  p_secondary_enabled   boolean DEFAULT false,
  p_secondary_cycles    int DEFAULT 3,
  p_str_cycles_m30      int DEFAULT 45,
  p_str_cycles_h1       int DEFAULT 90,
  p_str_cycles_h3       int DEFAULT 270,
  p_epsilon             numeric(12,6) DEFAULT NULL
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO user_space.params(
    user_id, primary_interval_ms, secondary_enabled, secondary_cycles,
    str_cycles_m30, str_cycles_h1, str_cycles_h3, epsilon, updated_at
  )
  VALUES (
    nullif(current_setting('app.current_user_id', true), '')::uuid,
    p_primary_interval_ms,
    coalesce(p_secondary_enabled, false),
    p_secondary_cycles,
    p_str_cycles_m30,
    p_str_cycles_h1,
    p_str_cycles_h3,
    p_epsilon,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET primary_interval_ms = EXCLUDED.primary_interval_ms,
        secondary_enabled   = EXCLUDED.secondary_enabled,
        secondary_cycles    = EXCLUDED.secondary_cycles,
        str_cycles_m30      = EXCLUDED.str_cycles_m30,
        str_cycles_h1       = EXCLUDED.str_cycles_h1,
        str_cycles_h3       = EXCLUDED.str_cycles_h3,
        epsilon             = EXCLUDED.epsilon,
        updated_at          = now();
$$;

-- View to expose per-user params, falling back to global settings.params
CREATE OR REPLACE VIEW user_space.v_params AS
SELECT
  coalesce(up.user_id, ctx.user_id) AS user_id,
  coalesce(up.primary_interval_ms, sp.primary_interval_ms) AS primary_interval_ms,
  coalesce(up.secondary_enabled,   sp.secondary_enabled)   AS secondary_enabled,
  coalesce(up.secondary_cycles,    sp.secondary_cycles)    AS secondary_cycles,
  coalesce(up.str_cycles_m30,      sp.str_cycles_m30)      AS str_cycles_m30,
  coalesce(up.str_cycles_h1,       sp.str_cycles_h1)       AS str_cycles_h1,
  coalesce(up.str_cycles_h3,       sp.str_cycles_h3)       AS str_cycles_h3,
  coalesce(up.epsilon,             NULL)                   AS epsilon,
  coalesce(up.updated_at,          sp.updated_at)          AS updated_at
FROM (SELECT nullif(current_setting('app.current_user_id', true), '')::uuid AS user_id) ctx
CROSS JOIN settings.params sp
LEFT JOIN user_space.params up
  ON up.user_id = ctx.user_id;

COMMIT;
