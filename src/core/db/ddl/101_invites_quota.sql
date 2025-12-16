BEGIN;

CREATE SCHEMA IF NOT EXISTS admin;

ALTER TABLE admin.invites
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_by uuid,
  ADD COLUMN IF NOT EXISTS note text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_invites_created_by_role_check'
      AND conrelid = 'admin.invites'::regclass
  ) THEN
    ALTER TABLE admin.invites
      DROP CONSTRAINT admin_invites_created_by_role_check;
  END IF;
END$$;

ALTER TABLE admin.invites
  ADD CONSTRAINT admin_invites_created_by_role_check
    CHECK (created_by_role IN ('admin','manager','system','user'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_admin_invites_token_hash'
      AND conrelid = 'admin.invites'::regclass
  ) THEN
    ALTER TABLE admin.invites
      ADD CONSTRAINT uq_admin_invites_token_hash UNIQUE (token_hash);
  END IF;
END$$;

UPDATE admin.invites
  SET recipient_email = COALESCE(recipient_email, target_email);

UPDATE admin.invites
  SET role = COALESCE(role, 'user');

UPDATE admin.invites
  SET token_hash = COALESCE(token_hash, encode(digest(token::text, 'sha256'), 'hex'))
  WHERE token_hash IS NULL AND token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_invites_creator_created_at
  ON admin.invites (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_invites_recipient_email
  ON admin.invites (lower(recipient_email));

CREATE INDEX IF NOT EXISTS idx_admin_invites_open_consumed
  ON admin.invites (expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
