-- 25_audit_user_scoped.sql
-- Per-user audit tables and summary view (extracted from legacy 24_audit.sql).

BEGIN;
CREATE SCHEMA IF NOT EXISTS audit;

-- Per-user cycle log
CREATE TABLE IF NOT EXISTS audit.user_cycle_log (
  cycle_log_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  cycle_seq          bigint NOT NULL,
  session_id         uuid,
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

COMMIT;

-- Attach FK to cin_aux.sessions when available
DO $$
BEGIN
  IF to_regclass('cin_aux.sessions') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_user_cycle_log_session'
        AND conrelid = 'audit.user_cycle_log'::regclass
    ) THEN
      ALTER TABLE audit.user_cycle_log
        ADD CONSTRAINT fk_user_cycle_log_session
        FOREIGN KEY (session_id)
        REFERENCES cin_aux.sessions(session_id)
        ON DELETE SET NULL;
    END IF;
  END IF;
END
$$;

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
