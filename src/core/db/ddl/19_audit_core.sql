BEGIN;

-- Ensure auth schema exists (functions below depend on it even if auth tables are applied later)
CREATE SCHEMA IF NOT EXISTS auth;

-- Request context helpers
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
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id::text, ''), false);
  PERFORM set_config('app.current_is_admin', CASE WHEN p_is_admin THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('app.current_session_id', COALESCE(NULLIF(p_session_id, ''), 'global'), false);

  -- Guard against badge/user mismatch when both are present
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

-- Error queue (system + user)
CREATE TABLE IF NOT EXISTS audit.error_queue (
  error_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin             text NOT NULL CHECK (origin IN ('user', 'system')),
  owner_user_id      uuid,
  cycle_seq          bigint,
  summary            text NOT NULL,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_by        uuid,
  resolved_at        timestamptz
);
CREATE INDEX IF NOT EXISTS ix_error_queue_status_time
  ON audit.error_queue (status, created_at DESC);

-- Attach auth FKs when auth.user exists
DO $$
BEGIN
  IF to_regclass('auth."user"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_error_queue_owner_user'
        AND conrelid = 'audit.error_queue'::regclass
    ) THEN
      ALTER TABLE audit.error_queue
        ADD CONSTRAINT fk_error_queue_owner_user
        FOREIGN KEY (owner_user_id)
        REFERENCES auth."user"(user_id)
        ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_error_queue_resolved_by'
        AND conrelid = 'audit.error_queue'::regclass
    ) THEN
      ALTER TABLE audit.error_queue
        ADD CONSTRAINT fk_error_queue_resolved_by
        FOREIGN KEY (resolved_by)
        REFERENCES auth."user"(user_id);
    END IF;
  END IF;
END
$$;

-- System vitals snapshots
CREATE TABLE IF NOT EXISTS audit.vitals_log (
  vitals_id          bigserial PRIMARY KEY,
  snapshot_ts        timestamptz NOT NULL DEFAULT now(),
  payload            jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_vitals_log_ts
  ON audit.vitals_log (snapshot_ts DESC);

COMMIT;

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
