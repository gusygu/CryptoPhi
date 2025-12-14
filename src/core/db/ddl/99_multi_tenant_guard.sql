-- 99_multi_tenant_guard.sql
-- Harden multi-tenant/session scoping: canonical coin universe view, stricter RLS, badge/user invariant.

BEGIN;

/* -------------------------------------------------------------------------- */
/* Canonical coin-universe resolver                                           */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE VIEW user_space.v_effective_coin_universe AS
WITH ctx AS (
  SELECT
    nullif(current_setting('app.current_session_id', true), '') AS session_id,
    nullif(current_setting('app.current_user_id', true), '')::uuid AS user_id
),
validated AS (
  -- only consider session rows when a user is present AND mapping exists
  SELECT
    ctx.session_id,
    ctx.user_id,
    EXISTS (
      SELECT 1 FROM user_space.session_map sm
       WHERE sm.session_id = ctx.session_id
         AND sm.user_id    = ctx.user_id
    ) AS has_map
  FROM ctx
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
  JOIN validated v ON v.session_id = scu.session_id
  LEFT JOIN settings.coin_universe cu ON cu.symbol = scu.symbol
  WHERE v.user_id IS NOT NULL AND v.has_map = true
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
WHERE (SELECT nullif(current_setting('app.current_user_id', true), '') IS NULL)
  OR sp.cnt = 0;

CREATE OR REPLACE VIEW user_space.v_coin_universe AS
SELECT symbol, enabled, user_id, sort_order, base_asset, quote_asset, metadata
FROM user_space.v_effective_coin_universe;

/* -------------------------------------------------------------------------- */
/* Bootstrap helper: seed session universe from global defaults once          */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION user_space.ensure_session_coin_universe_bootstrapped()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sid text := nullif(current_setting('app.current_session_id', true), '');
  uid uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  has_map boolean;
  existing int;
BEGIN
  IF sid IS NULL OR uid IS NULL THEN
    RAISE EXCEPTION 'bootstrap requires authenticated session' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_space.session_map sm
     WHERE sm.session_id = sid
       AND sm.user_id    = uid
  ) INTO has_map;
  IF NOT has_map THEN
    RAISE EXCEPTION 'badge mapping missing for session %', sid USING ERRCODE = '28000';
  END IF;

  SELECT COUNT(*) INTO existing
    FROM user_space.session_coin_universe scu
   WHERE scu.session_id = sid;
  IF existing > 0 THEN
    RETURN;
  END IF;

  INSERT INTO user_space.session_coin_universe(session_id, symbol, enabled, updated_at)
  SELECT sid,
         upper(coalesce(cu.symbol, '')),
         coalesce(cu.enabled, true),
         now()
    FROM settings.coin_universe cu
   WHERE coalesce(cu.enabled, true) = true
  ON CONFLICT (session_id, symbol) DO NOTHING;

  -- ensure USDT is present
  INSERT INTO user_space.session_coin_universe(session_id, symbol, enabled, updated_at)
  VALUES (sid, 'USDT', true, now())
  ON CONFLICT (session_id, symbol) DO NOTHING;
END;
$$;

/* -------------------------------------------------------------------------- */
/* RLS tighten for session_map and session_coin_universe                      */
/* -------------------------------------------------------------------------- */
ALTER TABLE user_space.session_map ENABLE ROW LEVEL SECURITY;
DO $pol$
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
END
$pol$;

ALTER TABLE user_space.session_coin_universe ENABLE ROW LEVEL SECURITY;
DO $pol$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'user_space'
       AND tablename = 'session_coin_universe'
       AND policyname = 'session_coin_universe_owned'
  ) THEN
    DROP POLICY session_coin_universe_owned ON user_space.session_coin_universe;
  END IF;

  CREATE POLICY session_coin_universe_owned ON user_space.session_coin_universe
    FOR ALL
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
END
$pol$;

/* -------------------------------------------------------------------------- */
/* auth.set_request_context guard                                            */
/* -------------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION auth.set_request_context(
  p_user_id     uuid,
  p_is_admin    boolean DEFAULT false,
  p_session_id  text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  has_session_map boolean := false;
BEGIN
  -- Persist for the backend session (not LOCAL) so subsequent statements see the GUCs.
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id::text, ''), false);
  PERFORM set_config('app.current_is_admin', CASE WHEN p_is_admin THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('app.current_session_id', COALESCE(NULLIF(p_session_id, ''), 'global'), false);

  IF p_user_id IS NOT NULL AND p_session_id IS NOT NULL THEN
    SELECT (to_regclass('user_space.session_map') IS NOT NULL) INTO has_session_map;
    IF has_session_map THEN
      IF NOT EXISTS (
        SELECT 1
          FROM user_space.session_map sm
         WHERE sm.session_id = p_session_id
           AND sm.user_id    = p_user_id
      ) THEN
        RAISE EXCEPTION 'session badge does not belong to user' USING ERRCODE = '28000';
      END IF;
    END IF;
  END IF;
END;
$$;

/* Resolve user_id from session_id bypassing RLS on session_map (badge-only flows). */
CREATE OR REPLACE FUNCTION auth.resolve_user_id_from_session(
  p_session_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, user_space
AS $$
DECLARE
  uid uuid;
BEGIN
  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN NULL;
  END IF;

  SELECT sm.user_id
    INTO uid
    FROM user_space.session_map sm
   WHERE sm.session_id = p_session_id
   LIMIT 1;

  RETURN uid;
END;
$$;

COMMIT;
