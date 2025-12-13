-- 07_matrices.sql
SET search_path = matrices, public;

/* -------------------------------------------------------------------------- */
/* A) Dynamic matrices (user-aware)                                           */
/* -------------------------------------------------------------------------- */

CREATE SCHEMA IF NOT EXISTS matrices;

DO $ddl$
DECLARE
  pk_needs_user boolean;
BEGIN
  -- Create fresh table if missing (already user-aware)
  IF to_regclass('matrices.dyn_values') IS NULL THEN
    EXECUTE $SQL$
      CREATE TABLE matrices.dyn_values (
        ts_ms          bigint           NOT NULL,
        matrix_type    text             NOT NULL CHECK (matrix_type IN ('benchmark','benchmark_trade','delta','pct24h','id_pct','pct_drv','ref','pct_ref','pct_snap','snap','pct_traded','traded')),
        base           text             NOT NULL,
        quote          text             NOT NULL,
        value          double precision NOT NULL,
        meta           jsonb            NOT NULL DEFAULT '{}'::jsonb,
        user_id        uuid,
        app_session_id text,
        user_key       uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
        snap           numeric,
        pct_snap       numeric,
        opening_stamp  boolean          NOT NULL DEFAULT false,
        opening_ts     timestamptz,
        snapshot_stamp boolean          NOT NULL DEFAULT false,
        snapshot_ts    timestamptz,
        trade_stamp    boolean          NOT NULL DEFAULT false,
        trade_ts       timestamptz,
        created_at     timestamptz      NOT NULL DEFAULT now(),
        CONSTRAINT dyn_values_pkey PRIMARY KEY (ts_ms, matrix_type, base, quote, user_key),
        CONSTRAINT chk_dyn_values_opening_ts CHECK (opening_stamp = false OR opening_ts IS NOT NULL),
        CONSTRAINT chk_dyn_values_snapshot_ts CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL),
        CONSTRAINT chk_dyn_values_trade_ts CHECK (trade_stamp = false OR trade_ts IS NOT NULL)
      )
    $SQL$;
  END IF;

  -- Backfill legacy tables with user-aware columns + guards
  ALTER TABLE matrices.dyn_values
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS app_session_id text,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
    ADD COLUMN IF NOT EXISTS snap numeric,
    ADD COLUMN IF NOT EXISTS pct_snap numeric,
    ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
    ADD COLUMN IF NOT EXISTS snapshot_stamp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS snapshot_ts timestamptz,
    ADD COLUMN IF NOT EXISTS trade_stamp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS trade_ts timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

  ALTER TABLE matrices.dyn_values
    DROP CONSTRAINT IF EXISTS dyn_values_matrix_type_check,
    ADD CONSTRAINT dyn_values_matrix_type_check CHECK (
      matrix_type IN ('benchmark','benchmark_trade','delta','pct24h','id_pct','pct_drv','ref','pct_ref','pct_snap','snap','pct_traded','traded')
    );

  ALTER TABLE matrices.dyn_values
    DROP CONSTRAINT IF EXISTS chk_dyn_values_opening_ts,
    ADD CONSTRAINT chk_dyn_values_opening_ts CHECK (opening_stamp = false OR opening_ts IS NOT NULL);
  ALTER TABLE matrices.dyn_values
    DROP CONSTRAINT IF EXISTS chk_dyn_values_snapshot_ts,
    ADD CONSTRAINT chk_dyn_values_snapshot_ts CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL);
  ALTER TABLE matrices.dyn_values
    DROP CONSTRAINT IF EXISTS chk_dyn_values_trade_ts,
    ADD CONSTRAINT chk_dyn_values_trade_ts CHECK (trade_stamp = false OR trade_ts IS NOT NULL);

  -- Ensure PK includes user_key (lets user_id stay NULL for global rows)
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'matrices'
      AND c.relname = 'dyn_values'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_needs_user;

  IF pk_needs_user THEN
    EXECUTE 'ALTER TABLE matrices.dyn_values DROP CONSTRAINT IF EXISTS dyn_values_pkey';
    EXECUTE 'ALTER TABLE matrices.dyn_values ADD CONSTRAINT dyn_values_pkey PRIMARY KEY (ts_ms, matrix_type, base, quote, user_key)';
  END IF;
END
$ddl$;

CREATE INDEX IF NOT EXISTS ix_dyn_values_pair_desc
  ON matrices.dyn_values (matrix_type, base, quote, ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_values_opening
  ON matrices.dyn_values (matrix_type, opening_stamp, ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_values_user
  ON matrices.dyn_values (user_id, app_session_id, ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_values_session
  ON matrices.dyn_values ((coalesce(meta->>'app_session_id','global')), ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_values_trade
  ON matrices.dyn_values (matrix_type, trade_stamp, trade_ts DESC, ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_values_trade_session
  ON matrices.dyn_values ((coalesce(meta->>'app_session_id','global')), trade_stamp, trade_ts DESC);

-- Stage table (ingestion buffer; user-aware)
DO $ddl$
DECLARE
  pk_needs_user boolean;
BEGIN
  IF to_regclass('matrices.dyn_values_stage') IS NULL THEN
    EXECUTE $SQL$
      CREATE TABLE matrices.dyn_values_stage (
        ts_ms          bigint           NOT NULL,
        matrix_type    text             NOT NULL,
        base           text             NOT NULL,
        quote          text             NOT NULL,
        value          double precision NOT NULL,
        meta           jsonb            NOT NULL DEFAULT '{}'::jsonb,
        user_id        uuid,
        app_session_id text,
        user_key       uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
        opening_stamp  boolean          NOT NULL DEFAULT false,
        opening_ts     timestamptz,
        snapshot_stamp boolean          NOT NULL DEFAULT false,
        snapshot_ts    timestamptz,
        trade_stamp    boolean          NOT NULL DEFAULT false,
        trade_ts       timestamptz,
        created_at     timestamptz      NOT NULL DEFAULT now(),
        CONSTRAINT dyn_values_stage_pkey PRIMARY KEY (ts_ms, matrix_type, base, quote, user_key),
        CONSTRAINT chk_dyn_stage_opening_ts CHECK (opening_stamp = false OR opening_ts IS NOT NULL),
        CONSTRAINT chk_dyn_stage_snapshot_ts CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL),
        CONSTRAINT chk_dyn_stage_trade_ts CHECK (trade_stamp = false OR trade_ts IS NOT NULL)
      )
    $SQL$;
  END IF;

  ALTER TABLE matrices.dyn_values_stage
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS app_session_id text,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
    ADD COLUMN IF NOT EXISTS opening_stamp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS opening_ts timestamptz,
    ADD COLUMN IF NOT EXISTS snapshot_stamp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS snapshot_ts timestamptz,
    ADD COLUMN IF NOT EXISTS trade_stamp boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS trade_ts timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

  ALTER TABLE matrices.dyn_values_stage
    DROP CONSTRAINT IF EXISTS chk_dyn_stage_opening_ts,
    ADD CONSTRAINT chk_dyn_stage_opening_ts CHECK (opening_stamp = false OR opening_ts IS NOT NULL);
  ALTER TABLE matrices.dyn_values_stage
    DROP CONSTRAINT IF EXISTS chk_dyn_stage_snapshot_ts,
    ADD CONSTRAINT chk_dyn_stage_snapshot_ts CHECK (snapshot_stamp = false OR snapshot_ts IS NOT NULL);
  ALTER TABLE matrices.dyn_values_stage
    DROP CONSTRAINT IF EXISTS chk_dyn_stage_trade_ts,
    ADD CONSTRAINT chk_dyn_stage_trade_ts CHECK (trade_stamp = false OR trade_ts IS NOT NULL);

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'matrices'
      AND c.relname = 'dyn_values_stage'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_needs_user;

  IF pk_needs_user THEN
    EXECUTE 'ALTER TABLE matrices.dyn_values_stage DROP CONSTRAINT IF EXISTS dyn_values_stage_pkey';
    EXECUTE 'ALTER TABLE matrices.dyn_values_stage ADD CONSTRAINT dyn_values_stage_pkey PRIMARY KEY (ts_ms, matrix_type, base, quote, user_key)';
  END IF;
END
$ddl$;

CREATE INDEX IF NOT EXISTS ix_dyn_stage_pair_desc
  ON matrices.dyn_values_stage (matrix_type, base, quote, ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_stage_user
  ON matrices.dyn_values_stage (user_id, app_session_id, ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_stage_session
  ON matrices.dyn_values_stage (coalesce(app_session_id,'global'), ts_ms DESC);
CREATE INDEX IF NOT EXISTS ix_dyn_stage_trade
  ON matrices.dyn_values_stage (trade_stamp, trade_ts DESC, ts_ms DESC);

COMMENT ON TABLE matrices.dyn_values IS 'Authoritative dynamic matrices (one row per matrix cell per cycle, session-scoped via meta->>app_session_id).';
COMMENT ON TABLE matrices.dyn_values_stage IS 'Stage/buffer for dynamic matrices before commit; app_session_id kept separate for clarity.';

/* -------------------------------------------------------------------------- */
/* B) Legacy series/points (kept for compatibility; minimally touched)       */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS series (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text UNIQUE,
  name       text,
  scope      text,
  unit       text,
  target     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS points (
  series_id  uuid NOT NULL REFERENCES matrices.series(id) ON DELETE CASCADE,
  ts         timestamptz NOT NULL,
  value      numeric NOT NULL,
  attrs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (series_id, ts)
);
CREATE INDEX IF NOT EXISTS ix_points_series_ts ON points(series_id, ts DESC);

CREATE OR REPLACE VIEW v_series_symbol AS
SELECT s.id, s.key, s.name, s.scope, s.unit,
       (s.target->>'symbol')::text AS symbol,
       s.target
FROM matrices.series s;

CREATE OR REPLACE VIEW v_latest_points AS
SELECT p.series_id, (SELECT key FROM matrices.series s WHERE s.id = p.series_id) AS series_key,
       p.ts, p.value, p.attrs
FROM (
  SELECT DISTINCT ON (series_id) series_id, ts, value, attrs
  FROM matrices.points
  ORDER BY series_id, ts DESC
) p;

CREATE OR REPLACE FUNCTION sp_ensure_series(
  _key text,
  _name text DEFAULT NULL,
  _scope text DEFAULT NULL,
  _unit text DEFAULT NULL,
  _target jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
  INSERT INTO matrices.series(key, name, scope, unit, target)
  VALUES (_key, _name, _scope, _unit, coalesce(_target,'{}'::jsonb))
  ON CONFLICT (key) DO UPDATE
    SET name   = coalesce(EXCLUDED.name,   matrices.series.name),
        scope  = coalesce(EXCLUDED.scope,  matrices.series.scope),
        unit   = coalesce(EXCLUDED.unit,   matrices.series.unit),
        target = CASE
                   WHEN EXCLUDED.target IS NULL OR EXCLUDED.target = '{}'::jsonb
                   THEN matrices.series.target
                   ELSE EXCLUDED.target
                 END
  RETURNING id INTO sid;
  RETURN sid;
END$$;

CREATE OR REPLACE FUNCTION sp_put_point(
  _series_key text,
  _ts timestamptz,
  _value numeric,
  _attrs jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
  sid := sp_ensure_series(_series_key, NULL, NULL, NULL, '{}'::jsonb);
  INSERT INTO matrices.points(series_id, ts, value, attrs)
  VALUES (sid, _ts, _value, coalesce(_attrs,'{}'::jsonb))
  ON CONFLICT (series_id, ts) DO UPDATE
    SET value = EXCLUDED.value,
        attrs = EXCLUDED.attrs;
END$$;

CREATE OR REPLACE FUNCTION sp_put_points_bulk(
  _series_key text,
  _rows jsonb
) RETURNS int LANGUAGE plpgsql AS $$
DECLARE sid uuid; r jsonb; n int := 0;
BEGIN
  sid := sp_ensure_series(_series_key, NULL, NULL, NULL, '{}'::jsonb);
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_rows,'[]'::jsonb)) LOOP
    INSERT INTO matrices.points(series_id, ts, value, attrs)
    VALUES (sid, (r->>'ts')::timestamptz, (r->>'value')::numeric, coalesce(r->'attrs','{}'::jsonb))
    ON CONFLICT (series_id, ts) DO UPDATE
      SET value = EXCLUDED.value,
          attrs = EXCLUDED.attrs;
    n := n + 1;
  END LOOP;
  RETURN n;
END$$;
