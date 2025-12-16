BEGIN;

-- Utility guard to avoid repeated statements in case tables move
DO $$
DECLARE dummy int;
BEGIN
  PERFORM 1;
END$$;

-- Ensure owner_user_id columns exist for RLS guards (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'audit' AND table_name = 'user_cycle_log' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE audit.user_cycle_log ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'audit' AND table_name = 'str_sampling_log' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE audit.str_sampling_log ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'audit' AND table_name = 'user_reports' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE audit.user_reports ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'audit' AND table_name = 'error_queue' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE audit.error_queue ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'sessions' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.sessions ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_session' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_session ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_balance' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_balance ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_reference' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_reference ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_lot' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_lot ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_move' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_move ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_move_lotlink' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_move_lotlink ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_mark' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_mark ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cin_aux' AND table_name = 'rt_imprint_luggage' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE cin_aux.rt_imprint_luggage ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'mea_dynamics' AND table_name = 'cycles' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE mea_dynamics.cycles ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'mea_dynamics' AND table_name = 'mea_symbol' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE mea_dynamics.mea_symbol ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'mea_dynamics' AND table_name = 'dynamics_snapshot' AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE mea_dynamics.dynamics_snapshot ADD COLUMN owner_user_id uuid;
  END IF;
END$$;

-- Audit tables RLS
ALTER TABLE audit.user_cycle_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_user_cycle_owner ON audit.user_cycle_log;
CREATE POLICY audit_user_cycle_owner ON audit.user_cycle_log
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_user_cycle_admin ON audit.user_cycle_log;
CREATE POLICY audit_user_cycle_admin ON audit.user_cycle_log
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.str_sampling_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_sampling_owner ON audit.str_sampling_log;
CREATE POLICY audit_sampling_owner ON audit.str_sampling_log
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_sampling_admin ON audit.str_sampling_log;
CREATE POLICY audit_sampling_admin ON audit.str_sampling_log
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.user_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_reports_owner ON audit.user_reports;
CREATE POLICY audit_reports_owner ON audit.user_reports
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_reports_admin ON audit.user_reports;
CREATE POLICY audit_reports_admin ON audit.user_reports
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.error_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_errors_owner ON audit.error_queue;
CREATE POLICY audit_errors_owner ON audit.error_queue
  FOR SELECT USING (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS audit_errors_admin ON audit.error_queue;
CREATE POLICY audit_errors_admin ON audit.error_queue
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE audit.vitals_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_vitals_admin ON audit.vitals_log;
CREATE POLICY audit_vitals_admin ON audit.vitals_log
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- Cin-aux session RLS
ALTER TABLE cin_aux.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_sessions_owner ON cin_aux.sessions;
CREATE POLICY cin_sessions_owner ON cin_aux.sessions
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_sessions_admin ON cin_aux.sessions;
CREATE POLICY cin_sessions_admin ON cin_aux.sessions
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_session_owner ON cin_aux.rt_session;
CREATE POLICY cin_rt_session_owner ON cin_aux.rt_session
  FOR ALL
  USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_session_admin ON cin_aux.rt_session;
CREATE POLICY cin_rt_session_admin ON cin_aux.rt_session
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- Cin-aux runtime tables
ALTER TABLE cin_aux.rt_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_balance_owner ON cin_aux.rt_balance;
CREATE POLICY cin_rt_balance_owner ON cin_aux.rt_balance
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_balance_admin ON cin_aux.rt_balance;
CREATE POLICY cin_rt_balance_admin ON cin_aux.rt_balance
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_reference_owner ON cin_aux.rt_reference;
CREATE POLICY cin_rt_reference_owner ON cin_aux.rt_reference
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_reference_admin ON cin_aux.rt_reference;
CREATE POLICY cin_rt_reference_admin ON cin_aux.rt_reference
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_lot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_lot_owner ON cin_aux.rt_lot;
CREATE POLICY cin_rt_lot_owner ON cin_aux.rt_lot
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_lot_admin ON cin_aux.rt_lot;
CREATE POLICY cin_rt_lot_admin ON cin_aux.rt_lot
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_move ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_move_owner ON cin_aux.rt_move;
CREATE POLICY cin_rt_move_owner ON cin_aux.rt_move
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_move_admin ON cin_aux.rt_move;
CREATE POLICY cin_rt_move_admin ON cin_aux.rt_move
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_move_lotlink ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_move_lotlink_owner ON cin_aux.rt_move_lotlink;
CREATE POLICY cin_rt_move_lotlink_owner ON cin_aux.rt_move_lotlink
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_move_lotlink_admin ON cin_aux.rt_move_lotlink;
CREATE POLICY cin_rt_move_lotlink_admin ON cin_aux.rt_move_lotlink
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_mark ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_mark_owner ON cin_aux.rt_mark;
CREATE POLICY cin_rt_mark_owner ON cin_aux.rt_mark
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_mark_admin ON cin_aux.rt_mark;
CREATE POLICY cin_rt_mark_admin ON cin_aux.rt_mark
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE cin_aux.rt_imprint_luggage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_imprint_owner ON cin_aux.rt_imprint_luggage;
CREATE POLICY cin_rt_imprint_owner ON cin_aux.rt_imprint_luggage
  FOR ALL USING (owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS cin_rt_imprint_admin ON cin_aux.rt_imprint_luggage;
CREATE POLICY cin_rt_imprint_admin ON cin_aux.rt_imprint_luggage
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- Matrices user data
ALTER TABLE matrices.dyn_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mat_dyn_owner ON matrices.dyn_values;
CREATE POLICY mat_dyn_owner ON matrices.dyn_values
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS mat_dyn_admin ON matrices.dyn_values;
CREATE POLICY mat_dyn_admin ON matrices.dyn_values
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE matrices.dyn_values_stage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mat_dyn_stage_owner ON matrices.dyn_values_stage;
CREATE POLICY mat_dyn_stage_owner ON matrices.dyn_values_stage
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS mat_dyn_stage_admin ON matrices.dyn_values_stage;
CREATE POLICY mat_dyn_stage_admin ON matrices.dyn_values_stage
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- STR-AUX user data
ALTER TABLE str_aux.samples_5s ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS str_samples_owner ON str_aux.samples_5s;
CREATE POLICY str_samples_owner ON str_aux.samples_5s
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS str_samples_admin ON str_aux.samples_5s;
CREATE POLICY str_samples_admin ON str_aux.samples_5s
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE str_aux.cycles_40s ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS str_cycles_owner ON str_aux.cycles_40s;
CREATE POLICY str_cycles_owner ON str_aux.cycles_40s
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS str_cycles_admin ON str_aux.cycles_40s;
CREATE POLICY str_cycles_admin ON str_aux.cycles_40s
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE str_aux.windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS str_windows_owner ON str_aux.windows;
CREATE POLICY str_windows_owner ON str_aux.windows
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS str_windows_admin ON str_aux.windows;
CREATE POLICY str_windows_admin ON str_aux.windows
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE str_aux.window_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS str_wstats_owner ON str_aux.window_stats;
CREATE POLICY str_wstats_owner ON str_aux.window_stats
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS str_wstats_admin ON str_aux.window_stats;
CREATE POLICY str_wstats_admin ON str_aux.window_stats
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE str_aux.window_vectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS str_wvec_owner ON str_aux.window_vectors;
CREATE POLICY str_wvec_owner ON str_aux.window_vectors
  FOR ALL USING (user_id IS NULL OR user_id = auth.current_user_id())
  WITH CHECK (user_id IS NULL OR user_id = auth.current_user_id());
DROP POLICY IF EXISTS str_wvec_admin ON str_aux.window_vectors;
CREATE POLICY str_wvec_admin ON str_aux.window_vectors
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- MEA dynamics user data
ALTER TABLE mea_dynamics.cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mea_cycles_owner ON mea_dynamics.cycles;
CREATE POLICY mea_cycles_owner ON mea_dynamics.cycles
  FOR ALL USING (owner_user_id IS NULL OR owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id IS NULL OR owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS mea_cycles_admin ON mea_dynamics.cycles;
CREATE POLICY mea_cycles_admin ON mea_dynamics.cycles
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE mea_dynamics.mea_symbol ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mea_symbol_owner ON mea_dynamics.mea_symbol;
CREATE POLICY mea_symbol_owner ON mea_dynamics.mea_symbol
  FOR ALL USING (owner_user_id IS NULL OR owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id IS NULL OR owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS mea_symbol_admin ON mea_dynamics.mea_symbol;
CREATE POLICY mea_symbol_admin ON mea_dynamics.mea_symbol
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

ALTER TABLE mea_dynamics.dynamics_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mea_dynsnap_owner ON mea_dynamics.dynamics_snapshot;
CREATE POLICY mea_dynsnap_owner ON mea_dynamics.dynamics_snapshot
  FOR ALL USING (owner_user_id IS NULL OR owner_user_id = auth.current_user_id())
  WITH CHECK (owner_user_id IS NULL OR owner_user_id = auth.current_user_id());
DROP POLICY IF EXISTS mea_dynsnap_admin ON mea_dynamics.dynamics_snapshot;
CREATE POLICY mea_dynsnap_admin ON mea_dynamics.dynamics_snapshot
  FOR ALL USING (auth.current_is_admin()) WITH CHECK (auth.current_is_admin());

-- Helper condition referencing rt_session ownership
CREATE OR REPLACE FUNCTION cin_aux._owns_rt_session(p_session_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cin_aux.rt_session s
    WHERE s.session_id = p_session_id
      AND (s.owner_user_id = auth.current_user_id() OR auth.current_is_admin())
  );
$$;

ALTER TABLE cin_aux.rt_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_balance_owner ON cin_aux.rt_balance;
CREATE POLICY cin_rt_balance_owner ON cin_aux.rt_balance
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_reference_owner ON cin_aux.rt_reference;
CREATE POLICY cin_rt_reference_owner ON cin_aux.rt_reference
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_lot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_lot_owner ON cin_aux.rt_lot;
CREATE POLICY cin_rt_lot_owner ON cin_aux.rt_lot
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_move ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_move_owner ON cin_aux.rt_move;
CREATE POLICY cin_rt_move_owner ON cin_aux.rt_move
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_move_lotlink ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_move_lotlink_owner ON cin_aux.rt_move_lotlink;
CREATE POLICY cin_rt_move_lotlink_owner ON cin_aux.rt_move_lotlink
  FOR ALL
  USING (
    cin_aux._owns_rt_session(
      (SELECT m.session_id FROM cin_aux.rt_move m WHERE m.move_id = cin_aux.rt_move_lotlink.move_id)
    )
  )
  WITH CHECK (
    cin_aux._owns_rt_session(
      (SELECT m.session_id FROM cin_aux.rt_move m WHERE m.move_id = cin_aux.rt_move_lotlink.move_id)
    )
  );

ALTER TABLE cin_aux.rt_mark ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_mark_owner ON cin_aux.rt_mark;
CREATE POLICY cin_rt_mark_owner ON cin_aux.rt_mark
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

ALTER TABLE cin_aux.rt_imprint_luggage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cin_rt_imprint_owner ON cin_aux.rt_imprint_luggage;
CREATE POLICY cin_rt_imprint_owner ON cin_aux.rt_imprint_luggage
  FOR ALL
  USING (cin_aux._owns_rt_session(session_id))
  WITH CHECK (cin_aux._owns_rt_session(session_id));

COMMIT;
