BEGIN;

-- 30_snapshot_stamps.sql
-- Align opening/snapshot boolean stamps across matrices, STR-AUX, and MEA tables.

-- 1) Snapshot stamps: ensure every target table has (snapshot_stamp boolean, snapshot_ts timestamptz)
DO $$
DECLARE
  rec record;
  qualified text;
  constraint_name text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('matrices','dyn_values'),
      ('matrices','dyn_values_stage'),
      ('str_aux','samples_run'),
      ('str_aux','stats_run'),
      ('str_aux','vectors_run'),
      ('mea_dynamics','dynamics_snapshot'),
      ('mea_dynamics','mea_symbol'),
      ('mea_dynamics','mood_registry')
    ) AS t(schema_name, table_name)
  LOOP
    qualified := rec.schema_name || '.' || rec.table_name;
    IF to_regclass(qualified) IS NULL THEN
      CONTINUE;
    END IF;

    -- legacy compatibility: rename timestamptz snapshot_stamp -> snapshot_ts if present
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = rec.schema_name
         AND table_name = rec.table_name
         AND column_name = 'snapshot_stamp'
         AND data_type = 'timestamp with time zone'
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN snapshot_stamp TO snapshot_ts',
        rec.schema_name, rec.table_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS snapshot_ts timestamptz',
      rec.schema_name, rec.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS snapshot_stamp boolean NOT NULL DEFAULT false',
      rec.schema_name, rec.table_name
    );

    constraint_name := format('chk_%s_%s_snapshot_stamp_ts', rec.schema_name, rec.table_name);
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conrelid = qualified::regclass
         AND conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL)',
        rec.schema_name, rec.table_name, constraint_name
      );
    END IF;
  END LOOP;
END $$;

-- 2) Opening stamps for matrices + STR-AUX atoms (needed for ref lookups)
DO $$
DECLARE
  rec record;
  qualified text;
  constraint_name text;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('matrices','dyn_values'),
      ('matrices','dyn_values_stage'),
      ('str_aux','samples_run'),
      ('str_aux','stats_run'),
      ('str_aux','vectors_run')
    ) AS t(schema_name, table_name)
  LOOP
    qualified := rec.schema_name || '.' || rec.table_name;
    IF to_regclass(qualified) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false',
      rec.schema_name, rec.table_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS opening_ts timestamptz',
      rec.schema_name, rec.table_name
    );

    constraint_name := format('chk_%s_%s_opening_stamp_ts', rec.schema_name, rec.table_name);
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conrelid = qualified::regclass
         AND conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (opening_stamp = false OR opening_ts IS NOT NULL)',
        rec.schema_name, rec.table_name, constraint_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
