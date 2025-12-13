-- 60_user_dashboard_views.sql
-- UI-facing per-user dashboard views (matrices, wallet, cin-aux, audit).

BEGIN;

CREATE SCHEMA IF NOT EXISTS dashboard;

-- Dashboard rollup (safe even if some views are missing)
DO $$
BEGIN
  IF to_regclass('matrices.v_user_dyn_latest') IS NOT NULL
     OR to_regclass('cin_aux.v_user_sessions_latest') IS NOT NULL
     OR to_regclass('audit.v_user_audit_summary') IS NOT NULL THEN
    EXECUTE $SQL$
      CREATE OR REPLACE VIEW dashboard.v_user_overview AS
      SELECT
        u.user_id,
        u.email,
        du.matrix_type,
        du.base,
        du.quote,
        du.value,
        du.ts_ms,
        cs.session_id,
        cs.status AS session_status,
        cs.created_at AS session_created_at,
        aus.total_reports,
        aus.cycle_issues,
        aus.sampling_issues,
        aus.open_errors
      FROM auth."user" u
      LEFT JOIN matrices.v_user_dyn_latest du ON (du.user_id = u.user_id OR du.user_id IS NULL)
      LEFT JOIN cin_aux.v_user_sessions_latest cs ON cs.owner_user_id = u.user_id
      LEFT JOIN audit.v_user_audit_summary aus ON aus.owner_user_id = u.user_id
      WHERE auth.current_user_id() IS NULL
         OR u.user_id = auth.current_user_id();
    $SQL$;
  END IF;
END$$;

COMMIT;
