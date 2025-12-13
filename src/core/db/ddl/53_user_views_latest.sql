-- 52_user_views_latest.sql
-- Per-user “latest” views aggregating user-driven tables (scoped by user_id/app_session_id).

BEGIN;

-- Latest matrices per user (if user_id column exists)
DO $$
BEGIN
  IF to_regclass('matrices.dyn_values') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='matrices' AND table_name='dyn_values' AND column_name='user_id'
     ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW matrices.v_user_dyn_latest AS
      SELECT DISTINCT ON (user_id, matrix_type, base, quote)
        user_id,
        app_session_id,
        matrix_type,
        base,
        quote,
        value,
        meta,
        ts_ms,
        opening_stamp,
        snapshot_stamp,
        snapshot_ts
      FROM matrices.dyn_values
      WHERE user_id IS NULL OR user_id = auth.current_user_id()
      ORDER BY user_id, matrix_type, base, quote, ts_ms DESC;
    $SQL$;
  END IF;
END$$;

-- Latest STR-AUX window stats per user (if user_id exists)
DO $$
BEGIN
  IF to_regclass('str_aux.window_stats') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='str_aux' AND table_name='window_stats' AND column_name='user_id'
     ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW str_aux.v_user_window_stats_latest AS
      SELECT DISTINCT ON (user_id, symbol, window_label)
        user_id,
        symbol,
        window_label,
        window_start,
        mean_inner,
        mean_outer,
        spread_avg,
        updated_at
      FROM str_aux.window_stats
      WHERE user_id IS NULL OR user_id = auth.current_user_id()
      ORDER BY user_id, symbol, window_label, window_start DESC;
    $SQL$;
  END IF;
END$$;

-- Latest CIN-AUX sessions per user
DO $$
BEGIN
  IF to_regclass('cin_aux.sessions') IS NOT NULL THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW cin_aux.v_user_sessions_latest AS
      SELECT DISTINCT ON (owner_user_id)
        owner_user_id,
        session_id,
        status,
        window_label,
        created_at,
        updated_at,
        opening_stamp,
        print_stamp
      FROM cin_aux.sessions
      WHERE owner_user_id IS NULL OR owner_user_id = auth.current_user_id()
      ORDER BY owner_user_id, created_at DESC;
    $SQL$;
  END IF;
END$$;

-- Latest MEA dynamics snapshot per user (if user_id exists)
DO $$
BEGIN
  IF to_regclass('mea_dynamics.dynamics_snapshot') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='mea_dynamics' AND table_name='dynamics_snapshot' AND column_name='owner_user_id'
     ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW mea_dynamics.v_user_dynamics_latest AS
      SELECT DISTINCT ON (owner_user_id, window_label)
        owner_user_id,
        window_label,
        engine_cycle,
        ts,
        base,
        quote,
        coins,
        candidates,
        mea_value,
        mea_tier,
        mood_id,
        mood_name,
        opening_stamp,
        print_stamp
      FROM mea_dynamics.dynamics_snapshot
      WHERE owner_user_id IS NULL OR owner_user_id = auth.current_user_id()
      ORDER BY owner_user_id, window_label, ts DESC, engine_cycle DESC;
    $SQL$;
  END IF;
END$$;

COMMIT;
