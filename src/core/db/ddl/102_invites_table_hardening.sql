-- 2025-12-16__invites_table_hardening.sql

CREATE SCHEMA IF NOT EXISTS admin;

-- Create table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS admin.invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  recipient_email text NULL,
  role text NOT NULL DEFAULT 'user',
  token_hash text NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  consumed_at timestamptz NULL,
  consumed_by uuid NULL,
  note text NULL
);

-- Harden: add missing columns if table existed with a different shape
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS created_by uuid NULL;
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS recipient_email text NULL;
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS token_hash text NULL;
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days');
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS consumed_at timestamptz NULL;
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS consumed_by uuid NULL;
ALTER TABLE admin.invites ADD COLUMN IF NOT EXISTS note text NULL;

-- If the DB uses `id` instead of `invite_id`, support that without breaking
-- (Only do this if column `invite_id` does NOT exist AND `id` does exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='admin' AND table_name='invites' AND column_name='invite_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='admin' AND table_name='invites' AND column_name='id'
  ) THEN
    -- create a computed-compatible view layer by adding invite_id and backfilling
    ALTER TABLE admin.invites ADD COLUMN invite_id uuid;
    UPDATE admin.invites SET invite_id = id WHERE invite_id IS NULL;
    ALTER TABLE admin.invites ALTER COLUMN invite_id SET NOT NULL;
    ALTER TABLE admin.invites ADD CONSTRAINT invites_invite_id_unique UNIQUE (invite_id);
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS invites_token_hash_uq ON admin.invites (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS invites_created_by_created_at_idx ON admin.invites (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS invites_recipient_email_idx ON admin.invites (recipient_email);
CREATE INDEX IF NOT EXISTS invites_pending_idx ON admin.invites (expires_at DESC) WHERE consumed_at IS NULL;

