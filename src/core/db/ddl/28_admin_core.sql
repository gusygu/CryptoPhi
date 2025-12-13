-- 28_admin_core.sql
-- Admin user-aware configuration (ownership, roles) split from global admin pack.

BEGIN;
CREATE SCHEMA IF NOT EXISTS admin;

-- Admin feature ownership registry
CREATE TABLE IF NOT EXISTS admin.user_features (
  feature_key text PRIMARY KEY,             -- e.g., 'mail', 'ops', 'ingest'
  owner_user_id uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin managers registry (lightweight)
CREATE TABLE IF NOT EXISTS admin.managers (
  manager_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth."user"(user_id) ON DELETE CASCADE,
  scope      text NOT NULL DEFAULT 'global',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Patch legacy admin.managers tables that predate the user_id/scope columns.
DO $ddl$
DECLARE
  missing_user_ids integer;
BEGIN
  IF to_regclass('admin.managers') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'admin'
        AND table_name   = 'managers'
        AND column_name  = 'user_id'
    ) THEN
      EXECUTE 'ALTER TABLE admin.managers
                 ADD COLUMN user_id uuid
                 REFERENCES auth."user"(user_id) ON DELETE CASCADE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'admin'
        AND table_name   = 'managers'
        AND column_name  = 'scope'
    ) THEN
      EXECUTE 'ALTER TABLE admin.managers
                 ADD COLUMN scope text NOT NULL DEFAULT ''global''';
    END IF;

    SELECT COUNT(*) INTO missing_user_ids
    FROM admin.managers
    WHERE user_id IS NULL;

    IF missing_user_ids = 0 THEN
      EXECUTE 'ALTER TABLE admin.managers
                 ALTER COLUMN user_id SET NOT NULL';
    ELSE
      RAISE NOTICE 'admin.managers.user_id left nullable; % existing rows missing values', missing_user_ids;
    END IF;
  END IF;
END
$ddl$;

CREATE INDEX IF NOT EXISTS idx_admin_managers_user ON admin.managers(user_id);

COMMIT;
