-- 40_session.sql
-- User-driven login sessions with stamp columns.

BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;
SET search_path = auth, public;

-- one row per login session / cookie
CREATE TABLE IF NOT EXISTS session (
  session_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  token_hash    text NOT NULL,                 -- sha256(cookie value)
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  ip            inet,
  user_agent    text,
  -- stamps
  opening_stamp   boolean    NOT NULL DEFAULT false,
  opening_ts      timestamptz,
  snapshot_stamp  boolean    NOT NULL DEFAULT false,
  snapshot_ts     timestamptz,
  CONSTRAINT chk_auth_session_opening_ts  CHECK (opening_stamp  = false OR opening_ts IS NOT NULL),
  CONSTRAINT chk_auth_session_snapshot_ts CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL)
);

-- Ensure stamp columns/constraints exist even if the table was created earlier
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'session') THEN
    ALTER TABLE auth.session
      ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
      ADD COLUMN IF NOT EXISTS snapshot_stamp boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS snapshot_ts timestamptz;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'chk_auth_session_opening_ts'
         AND conrelid = 'auth.session'::regclass
    ) THEN
      ALTER TABLE auth.session
        ADD CONSTRAINT chk_auth_session_opening_ts
        CHECK (opening_stamp = false OR opening_ts IS NOT NULL);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'chk_auth_session_snapshot_ts'
         AND conrelid = 'auth.session'::regclass
    ) THEN
      ALTER TABLE auth.session
        ADD CONSTRAINT chk_auth_session_snapshot_ts
        CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL);
    END IF;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_auth_session_token_hash
  ON session (token_hash);

CREATE INDEX IF NOT EXISTS idx_auth_session_user_expires
  ON session (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_session_snapshot
  ON session (snapshot_stamp, snapshot_ts);

CREATE INDEX IF NOT EXISTS idx_auth_session_opening
  ON session (opening_stamp, opening_ts);

COMMIT;
