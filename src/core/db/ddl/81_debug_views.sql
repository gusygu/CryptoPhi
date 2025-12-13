-- 81_debug_views.sql
-- Cross-schema debug/inspection views (placeholder).

BEGIN;

-- Example: expose latest vitals and error counts in one place
CREATE OR REPLACE VIEW debug.v_system_health AS
SELECT
  sas.snapshot_ts,
  sas.vitals_payload,
  sas.total_errors,
  sas.open_errors,
  sas.resolved_errors,
  sas.user_errors,
  sas.system_errors
FROM audit.v_system_audit_summary sas;

COMMIT;
