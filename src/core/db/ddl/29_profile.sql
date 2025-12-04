-- 3x_profile.sql (or append to existing ddl)
BEGIN;

CREATE SCHEMA IF NOT EXISTS profile;

CREATE TABLE IF NOT EXISTS profile.user_profile (
  user_id      uuid PRIMARY KEY,              -- FK to auth.users.user_id
  email        text NOT NULL,                 -- denormalized for convenience
  display_name text,                          -- user-chosen handle
  created_at   timestamptz NOT NULL DEFAULT now(),
  invited_by   uuid,                          -- FK to auth.users.user_id or admin.managers.manager_id
  invite_source text,                         -- 'admin' | 'manager' | 'public_token' | etc.
  locale       text DEFAULT 'en-US',
  timezone     text DEFAULT 'America/Sao_Paulo'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_email
  ON profile.user_profile (lower(email));

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS profile.user_settings (
  user_id uuid PRIMARY KEY REFERENCES profile.user_profile(user_id)
    ON DELETE CASCADE,
  density_mode text NOT NULL DEFAULT 'normal',    -- 'normal' | 'compact'
  is_advanced  boolean NOT NULL DEFAULT false,
  theme        text DEFAULT 'dark',              -- 'dark' | 'light' | 'system'
  default_matrix_window text DEFAULT '24h',      -- '24h', '7d', etc.
  favorite_symbols text[] DEFAULT '{}',          -- array of ticker strings
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_density
  ON profile.user_settings (density_mode);

COMMIT;
