BEGIN;

-- Request context helpers
CREATE OR REPLACE FUNCTION auth.set_request_context(
  p_user_id uuid,
  p_is_admin boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id::text, ''), false);
  PERFORM set_config('app.current_is_admin', CASE WHEN p_is_admin THEN 'true' ELSE 'false' END, false);
END;
$$;

CREATE OR REPLACE FUNCTION auth.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.current_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.current_is_admin', true) = 'true';
$$;

CREATE SCHEMA IF NOT EXISTS audit;

-- Per-user cycle log
CREATE TABLE IF NOT EXISTS audit.user_cycle_log (
  cycle_log_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint NOT NULL,
  session_id         uuid REFERENCES cin_aux.sessions(session_id) ON DELETE SET NULL,
  status             text NOT NULL,
  summary            text,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_user_cycle_log_owner_cycle
  ON audit.user_cycle_log (owner_user_id, cycle_seq DESC);

-- STR-aux sampling log
CREATE TABLE IF NOT EXISTS audit.str_sampling_log (
  sampling_log_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint,
  symbol             text NOT NULL,
  window_label       text NOT NULL,
  sample_ts          timestamptz,
  status             text NOT NULL,
  message            text,
  meta               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_str_sampling_owner_time
  ON audit.str_sampling_log (owner_user_id, created_at DESC);

-- User-submitted reports (mini-letters)
CREATE TABLE IF NOT EXISTS audit.user_reports (
  report_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint,
  category           text NOT NULL,
  severity           text NOT NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_by    uuid REFERENCES auth."user"(user_id),
  acknowledged_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_user_reports_owner_time
  ON audit.user_reports (owner_user_id, created_at DESC);

-- Error queue (system + user)
CREATE TABLE IF NOT EXISTS audit.error_queue (
  error_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin             text NOT NULL CHECK (origin IN ('user', 'system')),
  owner_user_id      uuid REFERENCES auth."user"(user_id) ON DELETE SET NULL,
  cycle_seq          bigint,
  summary            text NOT NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_by        uuid REFERENCES auth."user"(user_id),
  resolved_at        timestamptz
);
CREATE INDEX IF NOT EXISTS ix_error_queue_status_time
  ON audit.error_queue (status, created_at DESC);

-- System vitals snapshots
CREATE TABLE IF NOT EXISTS audit.vitals_log (
  vitals_id          bigserial PRIMARY KEY,
  snapshot_ts        timestamptz NOT NULL DEFAULT now(),
  payload            jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_vitals_log_ts
  ON audit.vitals_log (snapshot_ts DESC);

COMMIT;

-- Per-user audit summary (simple audit layer)
CREATE OR REPLACE VIEW audit.v_user_audit_summary AS
WITH cycle_agg AS (
  SELECT
    owner_user_id,
    max(cycle_seq)            AS last_cycle_seq,
    max(created_at)           AS last_cycle_at,
    count(*) FILTER (WHERE status <> 'ok') AS cycle_issues
  FROM audit.user_cycle_log
  GROUP BY owner_user_id
),
sampling_agg AS (
  SELECT
    owner_user_id,
    count(*) FILTER (WHERE status <> 'ok') AS sampling_issues
  FROM audit.str_sampling_log
  GROUP BY owner_user_id
),
reports_agg AS (
  SELECT
    owner_user_id,
    count(*) AS total_reports
  FROM audit.user_reports
  GROUP BY owner_user_id
),
errors_agg AS (
  SELECT
    owner_user_id,
    count(*) FILTER (WHERE status = 'open') AS open_errors
  FROM audit.error_queue
  WHERE origin = 'user'
  GROUP BY owner_user_id
)
SELECT
  u.user_id                         AS owner_user_id,
  u.email,
  c.last_cycle_seq,
  c.last_cycle_at,
  coalesce(c.cycle_issues, 0)       AS cycle_issues,
  coalesce(s.sampling_issues, 0)    AS sampling_issues,
  coalesce(r.total_reports, 0)      AS total_reports,
  coalesce(e.open_errors, 0)        AS open_errors
FROM auth."user" u
LEFT JOIN cycle_agg    c ON c.owner_user_id = u.user_id
LEFT JOIN sampling_agg s ON s.owner_user_id = u.user_id
LEFT JOIN reports_agg  r ON r.owner_user_id = u.user_id
LEFT JOIN errors_agg   e ON e.owner_user_id = u.user_id;

-- System-wide audit summary (admin/dev view)
CREATE OR REPLACE VIEW audit.v_system_audit_summary AS
WITH latest_vitals AS (
  SELECT
    snapshot_ts,
    payload
  FROM audit.vitals_log
  ORDER BY snapshot_ts DESC
  LIMIT 1
),
error_counts AS (
  SELECT
    count(*)                           AS total_errors,
    count(*) FILTER (WHERE status = 'open') AS open_errors,
    count(*) FILTER (WHERE status = 'resolved') AS resolved_errors
  FROM audit.error_queue
),
user_issue_counts AS (
  SELECT
    count(*) FILTER (WHERE origin = 'user')   AS user_errors,
    count(*) FILTER (WHERE origin = 'system') AS system_errors
  FROM audit.error_queue
)
SELECT
  v.snapshot_ts,
  v.payload                 AS vitals_payload,
  e.total_errors,
  e.open_errors,
  e.resolved_errors,
  u.user_errors,
  u.system_errors
FROM latest_vitals v
CROSS JOIN error_counts e
CROSS JOIN user_issue_counts u;

-- Compliance / record trail: manifest log (C)
CREATE TABLE IF NOT EXISTS audit.manifest_log (
  manifest_id     bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,               -- admin or script id
  app_version     text,
  ddl_pack_tag    text,
  docs_hash_pack  text,
  notes           text,
  manifest_json   jsonb               -- full manifest blob if desired
);

CREATE OR REPLACE VIEW audit.v_latest_manifest AS
SELECT *
FROM audit.manifest_log
ORDER BY created_at DESC
LIMIT 1;
