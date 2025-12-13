BEGIN;

-- Schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Users
CREATE TABLE IF NOT EXISTS auth."user" (
  user_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  nickname      text,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('pending', 'active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Invite requests (pre-reg)
CREATE TABLE IF NOT EXISTS auth.invite_request (
  request_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext NOT NULL,
  nickname     text,
  message      text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'converted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid REFERENCES auth."user"(user_id)
);
CREATE INDEX IF NOT EXISTS idx_auth_invite_request_status
  ON auth.invite_request (status);

-- Invitations (tokens)
CREATE TABLE IF NOT EXISTS auth.invite (
  invite_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       citext,                        -- optional: bound to specific email
  token_hash  text NOT NULL,                 -- sha256(raw token)
  created_by  uuid REFERENCES auth."user"(user_id),
  request_id  uuid REFERENCES auth.invite_request(request_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at     timestamptz,
  used_by     uuid REFERENCES auth."user"(user_id),
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'used', 'expired', 'revoked'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_invite_token_hash
  ON auth.invite (token_hash);

-- Audit log (generic events)
CREATE TABLE IF NOT EXISTS auth.audit_log (
  audit_id   bigserial PRIMARY KEY,
  user_id    uuid REFERENCES auth."user"(user_id),
  event      text NOT NULL,        -- 'invite.request', 'invite.created', 'login.success', ...
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- FK bridges to cin_aux ownership
DO $$
BEGIN
  IF to_regclass('cin_aux.sessions') IS NOT NULL
     AND to_regclass('auth."user"') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_cin_aux_sessions_owner_user'
         AND conrelid = to_regclass('cin_aux.sessions')
     ) THEN
    ALTER TABLE cin_aux.sessions
      ADD CONSTRAINT fk_cin_aux_sessions_owner_user
      FOREIGN KEY (owner_user_id)
      REFERENCES auth."user"(user_id)
      ON UPDATE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('cin_aux.rt_session') IS NOT NULL
     AND to_regclass('auth."user"') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_rt_session_owner_user'
         AND conrelid = to_regclass('cin_aux.rt_session')
     ) THEN
    ALTER TABLE cin_aux.rt_session
      ADD CONSTRAINT fk_rt_session_owner_user
      FOREIGN KEY (owner_user_id)
      REFERENCES auth."user"(user_id)
      ON UPDATE CASCADE;
  END IF;
END$$;

BEGIN;

-- Basic grants (tighten as needed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'invite_token'
  ) THEN
    REVOKE ALL ON auth.invite_token FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.invite_token TO cp_app, cp_admin;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'user_account'
  ) THEN
    REVOKE ALL ON auth.user_account FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.user_account TO cp_app, cp_admin;
    GRANT SELECT ON auth.user_account TO cp_reader;
  END IF;
  REVOKE ALL ON auth.invite_request FROM PUBLIC;
  GRANT SELECT, INSERT, UPDATE, DELETE ON auth.invite_request TO cp_app, cp_admin;
END$$;

-- Logs & jobs: readable by app + admin, not by random roles
REVOKE ALL ON ops.admin_action_log FROM PUBLIC;
REVOKE ALL ON ops.job_run          FROM PUBLIC;

GRANT SELECT, INSERT ON ops.admin_action_log TO cp_app, cp_admin;
GRANT SELECT        ON ops.admin_action_log TO cp_reader; -- read-only views

GRANT SELECT, INSERT, UPDATE ON ops.job_run TO cp_app, cp_admin;
GRANT SELECT                 ON ops.job_run TO cp_reader;

COMMIT;
