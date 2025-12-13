-- 80_audit_views.sql
-- Cross-schema audit views (admin dashboards) combining audit + admin action log.

BEGIN;

-- Simple admin-facing view: audit summary + admin action counts
CREATE OR REPLACE VIEW audit.v_admin_audit_overview AS
SELECT
  sas.snapshot_ts,
  sas.vitals_payload,
  sas.total_errors,
  sas.open_errors,
  sas.resolved_errors,
  sas.user_errors,
  sas.system_errors,
  aac.action_count,
  aac.last_action_at
FROM audit.v_system_audit_summary sas
LEFT JOIN (
  SELECT
    count(*) AS action_count,
    max(created_at) AS last_action_at
  FROM ops.admin_action_log
  WHERE created_at IS NOT NULL
  -- action_log table expected from 24_admin_action_log.sql
) aac ON true;

COMMIT;
