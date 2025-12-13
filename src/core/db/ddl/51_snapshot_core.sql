-- 50_snapshot_core.sql
-- Snapshot registry (user-driven bucket) and snapshot_stamp patching.

BEGIN;

CREATE SCHEMA IF NOT EXISTS snapshot;

-- Registry of snapshot reference points
CREATE TABLE IF NOT EXISTS snapshot.snapshot_registry (
  snapshot_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_stamp   timestamptz NOT NULL UNIQUE, -- shared across all tables for this snapshot

  label            text NOT NULL,               -- e.g. 'pre-release-2025-12-01'
  created_by_email text,                        -- who triggered it
  app_version      text,                        -- git tag / semver
  scope            text[] NOT NULL DEFAULT ARRAY[
                        'settings','market','wallet','matrices','str_aux','cin_aux','mea_dynamics','ops'
                     ],
  notes            text,
  client_context   jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_registry_stamp
  ON snapshot.snapshot_registry (snapshot_stamp DESC);

-- ================
-- Patch tables
-- ================

DO $snapshot$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT *
    FROM (VALUES
      ('settings','engine_params','settings_engine_params_snapshot_stamp_idx'),
      ('settings','external_accounts','settings_external_accounts_snapshot_stamp_idx'),
      ('settings','profile','settings_profile_snapshot_stamp_idx'),
      ('settings','wallet_link','settings_wallet_link_snapshot_stamp_idx'),
      ('settings','windows','settings_windows_snapshot_stamp_idx'),

      ('market','symbols','market_symbols_snapshot_stamp_idx'),
      ('market','klines','market_klines_snapshot_stamp_idx'),
      ('market','orderbook_levels','market_orderbook_levels_snapshot_stamp_idx'),
      ('market','orderbook_snapshots','market_orderbook_snapshots_snapshot_stamp_idx'),
      ('market','ticker_ticks','market_ticker_ticks_snapshot_stamp_idx'),
      ('market','ticker_latest','market_ticker_latest_snapshot_stamp_idx'),
      ('market','wallet_balances','market_wallet_balances_snapshot_stamp_idx'),

      ('matrices','dyn_values','matrices_dyn_values_snapshot_stamp_idx'),
      ('matrices','dyn_values_stage','matrices_dyn_values_stage_snapshot_stamp_idx'),

      ('str_aux','samples_run','str_aux_samples_run_snapshot_stamp_idx'),
      ('str_aux','stats_run','str_aux_stats_run_snapshot_stamp_idx'),
      ('str_aux','vectors_run','str_aux_vectors_run_snapshot_stamp_idx'),

      ('cin_aux','sessions','cin_aux_sessions_snapshot_stamp_idx'),
      ('cin_aux','session_coin_universe','cin_aux_session_coin_universe_snapshot_stamp_idx'),
      ('cin_aux','settings_coin_universe','cin_aux_settings_coin_universe_snapshot_stamp_idx'),
      ('cin_aux','mat_registry','cin_aux_mat_registry_snapshot_stamp_idx'),
      ('cin_aux','mat_cell','cin_aux_mat_cell_snapshot_stamp_idx'),
      ('cin_aux','mea_result','cin_aux_mea_result_snapshot_stamp_idx'),
      ('cin_aux','rt_session','cin_aux_rt_session_snapshot_stamp_idx'),
      ('cin_aux','rt_balance','cin_aux_rt_balance_snapshot_stamp_idx'),
      ('cin_aux','rt_imprint_luggage','cin_aux_rt_imprint_luggage_snapshot_stamp_idx'),
      ('cin_aux','rt_lot','cin_aux_rt_lot_snapshot_stamp_idx'),
      ('cin_aux','rt_mark','cin_aux_rt_mark_snapshot_stamp_idx'),
      ('cin_aux','rt_move','cin_aux_rt_move_snapshot_stamp_idx'),
      ('cin_aux','rt_move_lotlink','cin_aux_rt_move_lotlink_snapshot_stamp_idx'),
      ('cin_aux','rt_reference','cin_aux_rt_reference_snapshot_stamp_idx'),

      ('mea_dynamics','cycles','mea_dynamics_cycles_snapshot_stamp_idx'),
      ('mea_dynamics','dynamics_snapshot','mea_dynamics_dynamics_snapshot_snapshot_stamp_idx'),
      ('mea_dynamics','mea_mood_observations','mea_dynamics_mea_mood_observations_snapshot_stamp_idx'),
      ('mea_dynamics','mea_symbol','mea_dynamics_mea_symbol_snapshot_stamp_idx'),
      ('mea_dynamics','mood_registry','mea_dynamics_mood_registry_snapshot_stamp_idx'),

      ('ops','order','ops_order_snapshot_stamp_idx'),
      ('ops','fill','ops_fill_snapshot_stamp_idx')
    ) AS t(sch, rel, idx)
  LOOP
    IF to_regclass(format('%I.%I', rec.sch, rec.rel)) IS NULL THEN
      RAISE NOTICE 'Relation %.% missing; skipping snapshot stamp patch', rec.sch, rec.rel;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS snapshot_stamp timestamptz',
      rec.sch, rec.rel
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (snapshot_stamp)',
      rec.idx, rec.sch, rec.rel
    );
  END LOOP;
END
$snapshot$;

COMMIT;
