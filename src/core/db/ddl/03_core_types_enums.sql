-- 03_core_types_enums.sql
-- Central shared enums/types used across schemas.

BEGIN;

-- ops.side
DO $$
BEGIN
  CREATE TYPE ops.side AS ENUM ('buy','sell');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

-- ops.status
DO $$
BEGIN
  CREATE TYPE ops.status AS ENUM ('requested','placed','rejected','filled','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

-- ops.job_status
DO $$
BEGIN
  CREATE TYPE ops.job_status AS ENUM ('success','error','running','queued','skipped');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

COMMIT;
