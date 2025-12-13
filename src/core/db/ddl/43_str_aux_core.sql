-- 08_str-aux.sql — STR-AUX runtime (samples ➜ cycles ➜ windows)
-- Safe to re-run. No pgvector dependency. No stray market.ensure_symbol.
-- Assumptions:
--   • market.symbols(symbol text primary key or unique) exists
--   • settings.coin_universe(symbol, base_asset, quote_asset, enabled) exists
--   • 01_extensions.sql already loaded core extensions (pgcrypto, etc.)

create schema if not exists str_aux;
set search_path = str_aux, public;


-- === str_aux function guards: drop before recreate ===
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'str_aux'
      AND p.proname = ANY (ARRAY[
        'recompute_window_stats',
        'recompute_window_vectors',
        'recompute_all_stats'
      ])
  LOOP
    EXECUTE format('DROP FUNCTION str_aux.%I(%s);', r.proname, r.args);
    RAISE NOTICE 'Dropped str_aux.% (%)', r.proname, r.args;
  END LOOP;
END $$;


-- =============================================================================
-- 0) CONSTANTS & HELPERS
-- =============================================================================

-- canonical window seconds
create or replace function _window_seconds(_label text)
returns int language sql immutable as $$
  select case lower(_label)
           when '30s' then  30
           when '40s' then  40
           when '1m'  then  60
           when '3m'  then 180
           when '5m'  then 300
           when '15m' then 900
           when '30m' then 1800
           when '1h'  then 3600
           when '3h'  then 10800
           else null
         end;
$$;

-- floor to N seconds (tz-safe)
create or replace function _floor_to_seconds(_ts timestamptz, _sec int)
returns timestamptz language sql immutable as $$
  select to_timestamp((floor(extract(epoch from _ts)::bigint / _sec) * _sec));
$$;

-- clamp numeric (defensive)
create or replace function _clamp(_x numeric, _lo numeric, _hi numeric)
returns numeric language sql immutable as $$
  select greatest(_lo, least(_hi, _x));
$$;

-- =============================================================================
-- 1) SAMPLING SPEC
-- =============================================================================

create table if not exists sampling_specs (
  spec_id           smallserial primary key,
  label             text unique not null,     -- e.g., 'default'
  base_step_seconds int  not null default 5,  -- sample granularity
  cycle_seconds     int  not null default 40, -- 5s ➜ 40s cycle
  windows           text[] not null default array['30m','1h','3h']::text[],
  user_id           uuid,
  created_at        timestamptz not null default now()
);

insert into str_aux.sampling_specs(label)
values ('default')
on conflict (label) do nothing;

-- =============================================================================
-- 2) RAW SAMPLES (5s)
-- =============================================================================

create table if not exists samples_5s (
  symbol        text not null references market.symbols(symbol)
                  on update cascade on delete cascade,
  ts            timestamptz not null,
  user_id       uuid,
  app_session_id text,
  user_key      uuid generated always as (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  -- core signals (extend as needed)
  v_inner       numeric,
  v_outer       numeric,
  v_swap        numeric,
  v_tendency    numeric,
  disruption    numeric,
  amp           numeric,
  volt          numeric,
  inertia       numeric,
  -- modes / flags
  mode_general  smallint,
  mode_b        smallint,
  -- misc
  attrs         jsonb not null default '{}'::jsonb,
  bucket_count  smallint,
  tick_ms_min   int,
  tick_ms_max   int,
  tick_ms_avg   int,
  spread_min    numeric,
  spread_max    numeric,
  spread_avg    numeric,
  mid_min       numeric,
  mid_max       numeric,
  liquidity_imbalance numeric,
  quality_flags jsonb not null default '[]'::jsonb,
  primary key (symbol, ts, user_key)
);

alter table if exists samples_5s
  add column if not exists bucket_count smallint;
alter table if exists samples_5s
  add column if not exists tick_ms_min int;
alter table if exists samples_5s
  add column if not exists tick_ms_max int;
alter table if exists samples_5s
  add column if not exists tick_ms_avg int;
alter table if exists samples_5s
  add column if not exists spread_min numeric;
alter table if exists samples_5s
  add column if not exists spread_max numeric;
alter table if exists samples_5s
  add column if not exists spread_avg numeric;
alter table if exists samples_5s
  add column if not exists mid_min numeric;
alter table if exists samples_5s
  add column if not exists mid_max numeric;
alter table if exists samples_5s
  add column if not exists liquidity_imbalance numeric;
alter table if exists samples_5s
  add column if not exists quality_flags jsonb not null default '[]'::jsonb;

-- User-aware patches for existing tables
DO $patch$
DECLARE
  pk_missing boolean;
BEGIN
  -- If the legacy tables aren't present yet (fresh install), skip patching.
  IF to_regclass('str_aux.samples_5s') IS NULL
     OR to_regclass('str_aux.samples_5s_model') IS NULL
     OR to_regclass('str_aux.cycles_40s') IS NULL
     OR to_regclass('str_aux.windows') IS NULL
     OR to_regclass('str_aux.window_stats') IS NULL
     OR to_regclass('str_aux.window_vectors') IS NULL THEN
    RETURN;
  END IF;

  -- samples_5s
  ALTER TABLE str_aux.samples_5s
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS app_session_id text,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'str_aux'
      AND c.relname = 'samples_5s'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_missing;

  IF pk_missing THEN
    ALTER TABLE str_aux.samples_5s DROP CONSTRAINT IF EXISTS samples_5s_pkey;
    ALTER TABLE str_aux.samples_5s ADD CONSTRAINT samples_5s_pkey PRIMARY KEY (symbol, ts, user_key);
  END IF;

  -- samples_5s_model
  ALTER TABLE str_aux.samples_5s_model
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'str_aux'
      AND c.relname = 'samples_5s_model'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_missing;

  IF pk_missing THEN
    ALTER TABLE str_aux.samples_5s_model DROP CONSTRAINT IF EXISTS samples_5s_model_pkey;
    ALTER TABLE str_aux.samples_5s_model ADD CONSTRAINT samples_5s_model_pkey PRIMARY KEY (symbol, ts, user_key);
  END IF;

  -- cycles_40s
  ALTER TABLE str_aux.cycles_40s
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'str_aux'
      AND c.relname = 'cycles_40s'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_missing;

  IF pk_missing THEN
    ALTER TABLE str_aux.cycles_40s DROP CONSTRAINT IF EXISTS cycles_40s_pkey;
    ALTER TABLE str_aux.cycles_40s ADD CONSTRAINT cycles_40s_pkey PRIMARY KEY (symbol, cycle_start, user_key);
  END IF;

  -- Drop dependent FKs before adjusting windows PK
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='str_aux' AND table_name='window_stats'
      AND constraint_name='window_stats_symbol_window_label_window_start_fkey'
  ) THEN
    ALTER TABLE str_aux.window_stats DROP CONSTRAINT window_stats_symbol_window_label_window_start_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='str_aux' AND table_name='window_vectors'
      AND constraint_name='window_vectors_symbol_window_label_window_start_fkey'
  ) THEN
    ALTER TABLE str_aux.window_vectors DROP CONSTRAINT window_vectors_symbol_window_label_window_start_fkey;
  END IF;

  -- windows
  ALTER TABLE str_aux.windows
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'str_aux'
      AND c.relname = 'windows'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_missing;

  IF pk_missing THEN
    ALTER TABLE str_aux.windows DROP CONSTRAINT IF EXISTS windows_pkey;
    ALTER TABLE str_aux.windows ADD CONSTRAINT windows_pkey PRIMARY KEY (symbol, window_label, window_start, user_key);
  END IF;

  -- window_stats
  ALTER TABLE str_aux.window_stats
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='str_aux' AND table_name='window_stats'
      AND constraint_name='window_stats_symbol_window_label_window_start_fkey'
  ) THEN
    ALTER TABLE str_aux.window_stats DROP CONSTRAINT window_stats_symbol_window_label_window_start_fkey;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'str_aux'
      AND c.relname = 'window_stats'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_missing;

  IF pk_missing THEN
    ALTER TABLE str_aux.window_stats DROP CONSTRAINT IF EXISTS window_stats_pkey;
    ALTER TABLE str_aux.window_stats ADD CONSTRAINT window_stats_pkey PRIMARY KEY (symbol, window_label, window_start, user_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='str_aux' AND table_name='window_stats'
      AND constraint_name='window_stats_window_ref_fkey'
  ) THEN
    ALTER TABLE str_aux.window_stats
      ADD CONSTRAINT window_stats_window_ref_fkey
        FOREIGN KEY (symbol, window_label, window_start, user_key)
        REFERENCES str_aux.windows(symbol, window_label, window_start, user_key)
        ON DELETE CASCADE;
  END IF;

  -- window_vectors
  ALTER TABLE str_aux.window_vectors
    ADD COLUMN IF NOT EXISTS user_id uuid,
    ADD COLUMN IF NOT EXISTS user_key uuid GENERATED ALWAYS AS (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'str_aux'
      AND c.relname = 'window_vectors'
      AND i.indisprimary
      AND EXISTS (
        SELECT 1
        FROM unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
        WHERE a.attname = 'user_key'
      )
  ) INTO pk_missing;

  IF pk_missing THEN
    ALTER TABLE str_aux.window_vectors DROP CONSTRAINT IF EXISTS window_vectors_pkey;
    ALTER TABLE str_aux.window_vectors ADD CONSTRAINT window_vectors_pkey PRIMARY KEY (symbol, window_label, window_start, user_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema='str_aux' AND table_name='window_vectors'
      AND constraint_name='window_vectors_window_ref_fkey'
  ) THEN
    ALTER TABLE str_aux.window_vectors
      ADD CONSTRAINT window_vectors_window_ref_fkey
        FOREIGN KEY (symbol, window_label, window_start, user_key)
        REFERENCES str_aux.windows(symbol, window_label, window_start, user_key)
        ON DELETE CASCADE;
  END IF;
END
$patch$;

create index if not exists ix_5s_symbol_ts on samples_5s(symbol, ts desc);
create index if not exists ix_5s_ts       on samples_5s(ts desc);
create index if not exists ix_5s_user     on samples_5s(user_id, app_session_id, ts desc);

-- optional model snapshot aligned to 5s
create table if not exists samples_5s_model (
  symbol  text not null references market.symbols(symbol)
            on update cascade on delete cascade,
  ts      timestamptz not null,
  user_id uuid,
  user_key uuid generated always as (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  density jsonb not null,                -- histogram/bins, etc.
  stats   jsonb not null default '{}'::jsonb,
  primary key (symbol, ts, user_key)
);

create or replace function upsert_sample_5s(
  _symbol text, _ts timestamptz,
  _v_inner numeric, _v_outer numeric, _v_swap numeric, _v_tendency numeric,
  _disruption numeric, _amp numeric, _volt numeric, _inertia numeric,
  _mode_general smallint, _mode_b smallint, _attrs jsonb default '{}'::jsonb,
  _bucket_count smallint default null,
  _tick_ms_min int default null, _tick_ms_max int default null, _tick_ms_avg int default null,
  _spread_min numeric default null, _spread_max numeric default null, _spread_avg numeric default null,
  _mid_min numeric default null, _mid_max numeric default null,
  _liquidity_imbalance numeric default null,
  _quality_flags jsonb default '[]'::jsonb,
  _user_id uuid default null,
  _app_session_id text default null
) returns void language sql as $$
  insert into str_aux.samples_5s(
    symbol, ts, user_id, app_session_id,
    v_inner, v_outer, v_swap, v_tendency,
    disruption, amp, volt, inertia,
    mode_general, mode_b, attrs,
    bucket_count, tick_ms_min, tick_ms_max, tick_ms_avg,
    spread_min, spread_max, spread_avg,
    mid_min, mid_max,
    liquidity_imbalance,
    quality_flags
  )
  values (
    _symbol, _ts, _user_id, _app_session_id,
    _v_inner, _v_outer, _v_swap, _v_tendency,
    _disruption, _amp, _volt, _inertia,
    _mode_general, _mode_b, coalesce(_attrs,'{}'::jsonb),
    _bucket_count, _tick_ms_min, _tick_ms_max, _tick_ms_avg,
    _spread_min, _spread_max, _spread_avg,
    _mid_min, _mid_max,
    _liquidity_imbalance,
    coalesce(_quality_flags,'[]'::jsonb)
  )
  on conflict (symbol, ts, user_key) do update
    set v_inner = excluded.v_inner,
        v_outer = excluded.v_outer,
        v_swap  = excluded.v_swap,
        v_tendency = excluded.v_tendency,
        disruption = excluded.disruption,
        amp = excluded.amp,
        volt = excluded.volt,
        inertia = excluded.inertia,
        mode_general = excluded.mode_general,
        mode_b = excluded.mode_b,
        attrs = excluded.attrs,
        bucket_count = excluded.bucket_count,
        tick_ms_min = excluded.tick_ms_min,
        tick_ms_max = excluded.tick_ms_max,
        tick_ms_avg = excluded.tick_ms_avg,
        spread_min = excluded.spread_min,
        spread_max = excluded.spread_max,
        spread_avg = excluded.spread_avg,
        mid_min = excluded.mid_min,
        mid_max = excluded.mid_max,
        liquidity_imbalance = excluded.liquidity_imbalance,
        quality_flags = excluded.quality_flags,
        user_id = excluded.user_id,
        app_session_id = excluded.app_session_id;
$$;

create or replace function upsert_sample_5s_model(
  _symbol text, _ts timestamptz, _density jsonb, _stats jsonb default '{}'::jsonb, _user_id uuid default null
) returns void language sql as $$
  insert into str_aux.samples_5s_model(symbol, ts, user_id, density, stats)
  values (_symbol, _ts, _user_id, _density, coalesce(_stats,'{}'::jsonb))
  on conflict (symbol, ts, user_key) do update
    set density = excluded.density,
        stats   = excluded.stats,
        user_id = excluded.user_id;
$$;

-- =============================================================================
-- 3) CYCLES (40s)  — aggregates of 5s
-- =============================================================================

create table if not exists cycles_40s (
  symbol        text not null references market.symbols(symbol)
                  on update cascade on delete cascade,
  cycle_start   timestamptz not null,   -- inclusive, floored to cycle_seconds
  user_id       uuid,
  user_key      uuid generated always as (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  -- vector rollups
  v_inner_min   numeric, v_inner_max numeric, v_inner_avg numeric, v_inner_close numeric,
  v_outer_min   numeric, v_outer_max numeric, v_outer_avg numeric, v_outer_close numeric,
  v_swap_avg    numeric, v_swap_close numeric,
  v_tend_avg    numeric, v_tend_close numeric,
  -- stats
  disruption_avg numeric, amp_avg numeric, volt_avg numeric, inertia_avg numeric,
  -- modes (close)
  mode_general_close smallint, mode_b_close smallint,
  -- bookkeeping
  spec_label    text not null default 'default',
  updated_at    timestamptz not null default now(),
  primary key (symbol, cycle_start, user_key)
);

create index if not exists ix_cycle_symbol_start on cycles_40s(symbol, cycle_start desc);
create index if not exists ix_cycle_spec         on cycles_40s(spec_label);
create index if not exists ix_cycle_user         on cycles_40s(user_id, cycle_start desc);

-- core roller (idempotent upsert)
create or replace function sp_roll_cycle_40s(
  _symbol text,
  _cycle_start timestamptz,
  _spec_label text default 'default',
  _user_id uuid default null
) returns void language plpgsql as $$
declare
  cycle_len int;
  _from timestamptz; _to timestamptz;
  s record; close_row record;
begin
  select cycle_seconds into cycle_len
  from str_aux.sampling_specs where label=_spec_label;

  if cycle_len is null then
    raise exception 'sampling spec % not found', _spec_label;
  end if;

  _from := _cycle_start;
  _to   := _cycle_start + make_interval(secs => cycle_len);

  select
    count(*) n,
    min(v_inner) v_inner_min, max(v_inner) v_inner_max, avg(v_inner) v_inner_avg,
    min(v_outer) v_outer_min, max(v_outer) v_outer_max, avg(v_outer) v_outer_avg,
    avg(v_swap)  v_swap_avg,
    avg(v_tendency) v_tend_avg,
    avg(disruption) disruption_avg,
    avg(amp) amp_avg, avg(volt) volt_avg, avg(inertia) inertia_avg
  into s
  from str_aux.samples_5s
  where symbol=_symbol and ts >= _from and ts < _to
    and ( (_user_id is null and user_id is null) or (_user_id is not null and user_id = _user_id) );

  if s.n is null or s.n = 0 then
    return;
  end if;

  select
    v_inner as v_inner_close, v_outer as v_outer_close,
    v_swap  as v_swap_close,  v_tendency as v_tend_close,
    disruption as disruption_close, amp as amp_close,
    volt as volt_close, inertia as inertia_close,
    mode_general as mode_general_close, mode_b as mode_b_close
  into close_row
  from str_aux.samples_5s
  where symbol=_symbol and ts >= _from and ts < _to
  order by ts desc
  limit 1;

  insert into str_aux.cycles_40s as c (
    symbol, cycle_start, user_id,
    v_inner_min, v_inner_max, v_inner_avg, v_inner_close,
    v_outer_min, v_outer_max, v_outer_avg, v_outer_close,
    v_swap_avg,  v_swap_close,
    v_tend_avg,  v_tend_close,
    disruption_avg, amp_avg, volt_avg, inertia_avg,
    mode_general_close, mode_b_close,
    spec_label, updated_at
  )
  values (
    _symbol, _from, _user_id,
    s.v_inner_min, s.v_inner_max, s.v_inner_avg, close_row.v_inner_close,
    s.v_outer_min, s.v_outer_max, s.v_outer_avg, close_row.v_outer_close,
    s.v_swap_avg,  close_row.v_swap_close,
    s.v_tend_avg,  close_row.v_tend_close,
    s.disruption_avg, s.amp_avg, s.volt_avg, s.inertia_avg,
    close_row.mode_general_close, close_row.mode_b_close,
    _spec_label, now()
  )
  on conflict (symbol, cycle_start, user_key) do update
    set v_inner_min = excluded.v_inner_min,
        v_inner_max = excluded.v_inner_max,
        v_inner_avg = excluded.v_inner_avg,
        v_inner_close = excluded.v_inner_close,
        v_outer_min = excluded.v_outer_min,
        v_outer_max = excluded.v_outer_max,
        v_outer_avg = excluded.v_outer_avg,
        v_outer_close = excluded.v_outer_close,
        v_swap_avg = excluded.v_swap_avg,
        v_swap_close = excluded.v_swap_close,
        v_tend_avg = excluded.v_tend_avg,
        v_tend_close = excluded.v_tend_close,
        disruption_avg = excluded.disruption_avg,
        amp_avg = excluded.amp_avg,
        volt_avg = excluded.volt_avg,
        inertia_avg = excluded.inertia_avg,
        mode_general_close = excluded.mode_general_close,
        mode_b_close = excluded.mode_b_close,
        spec_label = excluded.spec_label,
        updated_at = now(),
        user_id = excluded.user_id;
end$$;

-- (optional) live-cycle trigger on sample insert
create or replace function trg_after_sample_5s()
returns trigger language plpgsql as $$
declare sec int := (select cycle_seconds from str_aux.sampling_specs where label='default');
begin
  perform str_aux.sp_roll_cycle_40s(
    NEW.symbol,
    str_aux._floor_to_seconds(NEW.ts, sec),
    'default',
    NEW.user_id
  );
  return null;
end$$;

drop trigger if exists t_after_sample_5s on str_aux.samples_5s;
create trigger t_after_sample_5s
after insert on str_aux.samples_5s
for each row execute function str_aux.trg_after_sample_5s();

-- =============================================================================
-- 4) WINDOWS (e.g., 30m / 1h / 3h) — aggregates of cycles
-- =============================================================================

create table if not exists windows (
  symbol        text not null references market.symbols(symbol)
                  on update cascade on delete cascade,
  window_label  text not null,          -- '30m' | '1h' | '3h' | etc.
  window_start  timestamptz not null,   -- inclusive anchor
  user_id       uuid,
  user_key      uuid generated always as (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  -- vector rollups
  v_inner_min   numeric, v_inner_max numeric, v_inner_avg numeric, v_inner_close numeric,
  v_outer_min   numeric, v_outer_max numeric, v_outer_avg numeric, v_outer_close numeric,
  v_swap_avg    numeric, v_swap_close numeric,
  v_tend_avg    numeric, v_tend_close numeric,
  -- stats
  disruption_avg numeric, amp_avg numeric, volt_avg numeric, inertia_avg numeric,
  -- modes
  mode_general_close smallint, mode_b_close smallint,
  -- counts
  cycles_count  int not null,
  -- bookkeeping
  spec_label    text not null default 'default',
  updated_at    timestamptz not null default now(),
  primary key (symbol, window_label, window_start, user_key)
);

create index if not exists ix_windows_symbol_lbl_start
  on windows(symbol, window_label, window_start desc);
create index if not exists ix_windows_symbol_label
  on windows(symbol, window_label);
create index if not exists ix_windows_updated
  on windows(updated_at desc);
create index if not exists ix_windows_user
  on windows(user_id, window_label, window_start desc);

create or replace function sp_roll_window_from_cycles(
  _symbol text, _window_label text, _window_start timestamptz, _spec_label text default 'default', _user_id uuid default null
) returns void language plpgsql as $$
declare
  wsec int := str_aux._window_seconds(_window_label);
  win_end timestamptz; s record; close_row record;
begin
  if wsec is null then
    raise exception 'invalid window label %', _window_label;
  end if;

  win_end := _window_start + make_interval(secs => wsec);

  select
    count(*) cycles_count,
    min(v_inner_min) v_inner_min, max(v_inner_max) v_inner_max, avg(v_inner_avg) v_inner_avg,
    min(v_outer_min) v_outer_min, max(v_outer_max) v_outer_max, avg(v_outer_avg) v_outer_avg,
    avg(v_swap_avg)  v_swap_avg,
    avg(v_tend_avg)  v_tend_avg,
    avg(disruption_avg) disruption_avg,
    avg(amp_avg) amp_avg, avg(volt_avg) volt_avg, avg(inertia_avg) inertia_avg
  into s
  from str_aux.cycles_40s
  where symbol=_symbol
    and spec_label=_spec_label
    and ( (_user_id is null and user_id is null) or (_user_id is not null and user_id = _user_id) )
    and cycle_start >= _window_start
    and cycle_start <  win_end;

  if s.cycles_count is null or s.cycles_count = 0 then
    return;
  end if;

  select
    v_inner_close, v_outer_close, v_swap_close, v_tend_close,
    mode_general_close, mode_b_close
  into close_row
  from str_aux.cycles_40s
  where symbol=_symbol and spec_label=_spec_label
    and ( (_user_id is null and user_id is null) or (_user_id is not null and user_id = _user_id) )
    and cycle_start >= _window_start and cycle_start < win_end
  order by cycle_start desc
  limit 1;

  insert into str_aux.windows as w (
    symbol, window_label, window_start, user_id,
    v_inner_min, v_inner_max, v_inner_avg, v_inner_close,
    v_outer_min, v_outer_max, v_outer_avg, v_outer_close,
    v_swap_avg,  v_swap_close,
    v_tend_avg,  v_tend_close,
    disruption_avg, amp_avg, volt_avg, inertia_avg,
    mode_general_close, mode_b_close,
    cycles_count, spec_label, updated_at
  )
  values (
    _symbol, _window_label, _window_start, _user_id,
    s.v_inner_min, s.v_inner_max, s.v_inner_avg, close_row.v_inner_close,
    s.v_outer_min, s.v_outer_max, s.v_outer_avg, close_row.v_outer_close,
    s.v_swap_avg,  close_row.v_swap_close,
    s.v_tend_avg,  close_row.v_tend_close,
    s.disruption_avg, s.amp_avg, s.volt_avg, s.inertia_avg,
    close_row.mode_general_close, close_row.mode_b_close,
    s.cycles_count, _spec_label, now()
  )
  on conflict (symbol, window_label, window_start, user_key) do update
    set v_inner_min = excluded.v_inner_min,
        v_inner_max = excluded.v_inner_max,
        v_inner_avg = excluded.v_inner_avg,
        v_inner_close = excluded.v_inner_close,
        v_outer_min = excluded.v_outer_min,
        v_outer_max = excluded.v_outer_max,
        v_outer_avg = excluded.v_outer_avg,
        v_outer_close = excluded.v_outer_close,
        v_swap_avg = excluded.v_swap_avg,
        v_swap_close = excluded.v_swap_close,
        v_tend_avg = excluded.v_tend_avg,
        v_tend_close = excluded.v_tend_close,
        disruption_avg = excluded.disruption_avg,
        amp_avg = excluded.amp_avg,
        volt_avg = excluded.volt_avg,
        inertia_avg = excluded.inertia_avg,
        mode_general_close = excluded.mode_general_close,
        mode_b_close = excluded.mode_b_close,
        cycles_count = excluded.cycles_count,
        spec_label = excluded.spec_label,
        updated_at = now(),
        user_id = excluded.user_id;
end$$;

-- roll cycles across a span
create or replace function roll_cycles_40s_between(
  _symbol text, _from timestamptz, _to timestamptz, _spec_label text default 'default', _user_id uuid default null
) returns int language plpgsql as $$
declare cycle_len int; cur timestamptz; n int := 0;
begin
  select cycle_seconds into cycle_len from str_aux.sampling_specs where label=_spec_label;
  if cycle_len is null then raise exception 'sampling spec % not found', _spec_label; end if;

  cur := _floor_to_seconds(_from, cycle_len);
  while cur < _to loop
    perform sp_roll_cycle_40s(_symbol, cur, _spec_label, _user_id);
    n := n + 1;
    cur := cur + make_interval(secs => cycle_len);
  end loop;
  return n;
end$$;

-- roll current window “now”
create or replace function try_roll_window_now(
  _symbol text, _window_label text, _spec_label text default 'default', _user_id uuid default null
) returns void language plpgsql as $$
declare wsec int := str_aux._window_seconds(_window_label);
begin
  if wsec is null then raise exception 'invalid window label %', _window_label; end if;
  perform str_aux.sp_roll_window_from_cycles(
    _symbol, _window_label,
    _floor_to_seconds(now() - make_interval(secs => wsec), wsec),
    _spec_label,
    _user_id
  );
end$$;

-- roll all configured windows “now”
create or replace function try_roll_all_windows_now(
  _symbol text, _spec_label text default 'default', _user_id uuid default null
) returns int language plpgsql as $$
declare wlbl text; wsec int; n int := 0;
begin
  for wlbl in
    select unnest(windows) from str_aux.sampling_specs where label=_spec_label
  loop
    wsec := str_aux._window_seconds(wlbl);
    if wsec is not null then
      perform str_aux.sp_roll_window_from_cycles(
        _symbol, wlbl,
        str_aux._floor_to_seconds(now() - make_interval(secs => wsec), wsec),
        _spec_label,
        _user_id
      );
      n := n + 1;
    end if;
  end loop;
  return n;
end$$;

-- backfill a whole span: cycles + windows
create or replace function backfill_symbol_between(
  _symbol text, _from timestamptz, _to timestamptz, _spec_label text default 'default'
) returns text language plpgsql as $$
declare
  n_cycles int := 0; n_wins int := 0; wlbl text; wsec int; cur timestamptz;
begin
  n_cycles := str_aux.roll_cycles_40s_between(_symbol, _from, _to, _spec_label);

  for wlbl in select unnest(windows) from str_aux.sampling_specs where label=_spec_label loop
    wsec := str_aux._window_seconds(wlbl);
    if wsec is null then continue; end if;

    cur := str_aux._floor_to_seconds(_from, wsec);
    while cur < _to loop
      perform str_aux.sp_roll_window_from_cycles(_symbol, wlbl, cur, _spec_label);
      n_wins := n_wins + 1;
      cur := cur + make_interval(secs => wsec);
    end loop;
  end loop;

  return format('cycles=%s windows=%s', n_cycles, n_wins);
end$$;

-- =============================================================================
-- 5) DERIVED ARTIFACTS (stats/vectors, JSON-only)
-- =============================================================================

create table if not exists window_stats (
  symbol        text not null,
  window_label  text not null,
  window_start  timestamptz not null,
  user_id       uuid,
  user_key      uuid generated always as (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  mean_inner    numeric,
  var_inner     numeric,
  skew_inner    numeric,
  mean_outer    numeric,
  var_outer     numeric,
  skew_outer    numeric,
  spread_avg    numeric,
  spread_p95    numeric,
  updated_at    timestamptz not null default now(),
  primary key (symbol, window_label, window_start, user_key),
  foreign key (symbol, window_label, window_start, user_key)
    references str_aux.windows(symbol, window_label, window_start, user_key)
    on delete cascade
);

create table if not exists window_vectors (
  symbol        text not null,
  window_label  text not null,
  window_start  timestamptz not null,
  user_id       uuid,
  user_key      uuid generated always as (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  vec           jsonb not null, -- upgrade later if you adopt pgvector
  updated_at    timestamptz not null default now(),
  primary key (symbol, window_label, window_start, user_key),
  foreign key (symbol, window_label, window_start, user_key)
    references str_aux.windows(symbol, window_label, window_start, user_key)
    on delete cascade
);

create index if not exists ix_win_stats_user
  on window_stats(user_id, symbol, window_label, window_start);
create index if not exists ix_win_vectors_user
  on window_vectors(user_id, symbol, window_label, window_start);

create or replace function recompute_window_stats(_symbol text, _label text)
returns int language plpgsql as $$
declare n int := 0;
begin
  insert into str_aux.window_stats(symbol, window_label, window_start,
                                   user_id,
                                   mean_inner, var_inner, skew_inner,
                                   mean_outer, var_outer, skew_outer,
                                   spread_avg, spread_p95, updated_at)
  select w.symbol, w.window_label, w.window_start, w.user_id,
         w.v_inner_avg, null, null,
         w.v_outer_avg, null, null,
         (w.v_outer_avg - w.v_inner_avg), null, now()
  from str_aux.windows w
  where w.symbol=_symbol and w.window_label=_label
  on conflict (symbol, window_label, window_start, user_key) do update
    set mean_inner = excluded.mean_inner,
        mean_outer = excluded.mean_outer,
        spread_avg = excluded.spread_avg,
        updated_at = now(),
        user_id = excluded.user_id;
  get diagnostics n = row_count;
  return n;
end$$;

create or replace function recompute_window_vectors(_symbol text, _label text)
returns int language plpgsql as $$
declare n int := 0;
begin
  insert into str_aux.window_vectors(symbol, window_label, window_start, user_id, vec, updated_at)
  select w.symbol, w.window_label, w.window_start, w.user_id,
         jsonb_build_object(
           'inner', jsonb_build_object('avg', w.v_inner_avg, 'close', w.v_inner_close),
           'outer', jsonb_build_object('avg', w.v_outer_avg, 'close', w.v_outer_close),
           'swap',  jsonb_build_object('avg', w.v_swap_avg,  'close', w.v_swap_close),
           'tend',  jsonb_build_object('avg', w.v_tend_avg,  'close', w.v_tend_close)
         ),
         now()
  from str_aux.windows w
  where w.symbol=_symbol and w.window_label=_label
  on conflict (symbol, window_label, window_start, user_key) do update
    set vec = excluded.vec, updated_at = now(), user_id = excluded.user_id;
  get diagnostics n = row_count;
  return n;
end$$;

-- batch recompute for all labels of a symbol
create or replace function recompute_all_for_symbol(_symbol text)
returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select distinct window_label, user_id from str_aux.windows where symbol=_symbol loop
    n := n + coalesce(str_aux.recompute_window_stats(_symbol, r.window_label),0);
    n := n + coalesce(str_aux.recompute_window_vectors(_symbol, r.window_label),0);
  end loop;
  return n;
end$$;

-- =============================================================================
-- 6) VIEWS (read APIs)
-- =============================================================================

-- read enabled symbols (from settings)
create or replace view v_enabled_symbols as
select
  cu.symbol, cu.base_asset, cu.quote_asset
from settings.coin_universe cu
where cu.enabled is true;

-- latest window per (symbol, label)
create or replace view v_latest_windows as
select distinct on (w.symbol, w.window_label)
  w.symbol, w.window_label, w.window_start,
  w.v_inner_close, w.v_outer_close, w.v_swap_close, w.v_tend_close,
  w.disruption_avg, w.amp_avg, w.volt_avg, w.inertia_avg,
  w.mode_general_close, w.mode_b_close,
  w.cycles_count, w.spec_label, w.updated_at
from str_aux.windows w
order by w.symbol, w.window_label, w.window_start desc;

-- health snapshot
create or replace view v_health as
with last_sample as (
  select symbol, max(ts) as last_ts from str_aux.samples_5s group by symbol
), last_cycle as (
  select symbol, max(cycle_start) as last_cycle from str_aux.cycles_40s group by symbol
), last_win as (
  select symbol, window_label, max(window_start) as last_win
  from str_aux.windows group by symbol, window_label
)
select
  cu.symbol,
  cu.enabled,
  ls.last_ts       as last_sample_ts,
  lc.last_cycle    as last_cycle_start,
  lw.window_label,
  lw.last_win      as last_window_start
from settings.coin_universe cu
left join last_sample ls on ls.symbol = cu.symbol
left join last_cycle  lc on lc.symbol = cu.symbol
left join last_win    lw on lw.symbol = cu.symbol
where cu.enabled is true;

-- convenience: flow gaps
create or replace view v_flow_gaps as
with e as (
  select symbol from settings.coin_universe where enabled
), ls as (
  select symbol, max(ts) as last_sample_ts from str_aux.samples_5s group by symbol
), lc as (
  select symbol, max(cycle_start) as last_cycle_start from str_aux.cycles_40s group by symbol
)
select
  e.symbol,
  ls.last_sample_ts,
  lc.last_cycle_start
from e
left join ls using(symbol)
left join lc using(symbol)
order by e.symbol;

-- =============================================================================
-- 7) OPTIONAL: PER-SYMBOL WINDOW OVERRIDES
-- =============================================================================

create table if not exists symbol_specs (
  symbol     text primary key references market.symbols(symbol) on delete cascade,
  spec_label text not null references str_aux.sampling_specs(label) on delete restrict,
  windows    text[] not null,
  updated_at timestamptz not null default now()
);

create or replace function get_windows_for_symbol(_symbol text, _spec_label text)
returns text[] language sql stable as $$
  select coalesce(ss.windows, s.windows)
  from str_aux.sampling_specs s
  left join str_aux.symbol_specs ss
    on ss.symbol=_symbol and ss.spec_label=s.label
  where s.label=_spec_label;
$$;

create or replace function try_roll_all_windows_now__override(
  _symbol text, _spec_label text default 'default', _user_id uuid default null
) returns int language plpgsql as $$
declare wlbl text; n int := 0; arr text[];
begin
  select str_aux.get_windows_for_symbol(_symbol, _spec_label) into arr;
  if arr is null then return 0; end if;
  foreach wlbl in array arr loop
    perform str_aux.try_roll_window_now(_symbol, wlbl, _spec_label, _user_id);
    n := n + 1;
  end loop;
  return n;
end$$;

-- optional seeds (safe no-ops if already there)
insert into str_aux.symbol_specs(symbol, spec_label, windows)
select 'BTCUSDT','default', array['1m','3m','5m','15m','1h']
where exists (select 1 from market.symbols where symbol = 'BTCUSDT')
  and not exists (select 1 from str_aux.symbol_specs where symbol='BTCUSDT');

insert into str_aux.symbol_specs(symbol, spec_label, windows)
select 'SOLUSDT','default', array['15m','30m','1h','3h']
where exists (select 1 from market.symbols where symbol = 'SOLUSDT')
  and not exists (select 1 from str_aux.symbol_specs where symbol='SOLUSDT');

-- =============================================================================
-- 8) CONSTRAINTS TO SUPPORT APP UPSERTS
-- =============================================================================
-- App routes use ON CONFLICT (symbol, window_label, window_start). Add matching uniques.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'uq_str_aux_windows_triple'
       and conrelid = 'str_aux.windows'::regclass
  ) then
    alter table str_aux.windows
      add constraint uq_str_aux_windows_triple unique (symbol, window_label, window_start);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'uq_str_aux_window_vectors_triple'
       and conrelid = 'str_aux.window_vectors'::regclass
  ) then
    alter table str_aux.window_vectors
      add constraint uq_str_aux_window_vectors_triple unique (symbol, window_label, window_start);
  end if;
end$$;

-- =============================================================================
-- 8) SECURITY (RLS optional) & GRANTS
-- =============================================================================

-- RLS templates (keep disabled during bring-up; enable when ready)
-- alter table str_aux.samples_5s       enable row level security;
-- alter table str_aux.samples_5s_model enable row level security;
-- alter table str_aux.cycles_40s       enable row level security;
-- alter table str_aux.windows          enable row level security;
-- alter table str_aux.window_stats     enable row level security;
-- alter table str_aux.window_vectors   enable row level security;

-- create policy p_5s_r on str_aux.samples_5s for select using (true);
-- create policy p_5s_w on str_aux.samples_5s for insert with check (true);
-- create policy p_5s_u on str_aux.samples_5s for update using (true) with check (true);
-- (repeat minimal policies for other tables if you enable RLS)

-- pragmatic grants (adjust to your roles)
do $$
begin
  perform 1 from pg_roles where rolname = 'cp_writer';
  if found then
    grant usage on schema str_aux to cp_writer, cp_reader;
    grant select, insert, update on str_aux.samples_5s       to cp_writer;
    grant select, insert, update on str_aux.samples_5s_model to cp_writer;
    grant select, insert, update on str_aux.cycles_40s       to cp_writer;
    grant select, insert, update on str_aux.windows          to cp_writer;
    grant select, insert, update on str_aux.window_stats     to cp_writer;
    grant select, insert, update on str_aux.window_vectors   to cp_writer;
    grant select on all tables in schema str_aux to cp_reader;
  end if;
end$$;

-- =============================================================================
-- 9) SANITY GUARDS
-- =============================================================================

-- never define market.ensure_symbol here (warn if rogue version exists)
do $$
begin
  if exists (
    select 1
    from pg_proc
    where pronamespace = 'market'::regnamespace
      and proname = 'ensure_symbol'
      and oid::regprocedure::text like 'ensure_symbol(text)'
  ) then
    raise warning 'Found market.ensure_symbol(text). Prefer market.sp_upsert_symbol in market schema.';
  end if;
end$$;


-- 09_straux_autonomy.sql
-- Makes the system self-starting from settings.coin_universe.
--  • Auto-mirror settings → market on insert/update/delete
--  • Nice views for ingestion targets & freshness
--  • NOTIFY when the universe changes (daemon listens)
--  • Roll helpers across all enabled symbols

-- ─────────────────────────────────────────────────────────────────────────────
-- A) Auto-mirror on universe changes + NOTIFY

create or replace function settings.trg_coin_universe_sync()
returns trigger language plpgsql as $$
begin
  -- Keep market in sync (uses your patched mirror)
  perform settings.sp_mirror_universe_to_market();

  -- Publish a single, debounced universe-changed event
  perform pg_notify('settings_universe_changed', coalesce(NEW.symbol, OLD.symbol));

  return null;
end$$;

drop trigger if exists t_sync_coin_universe_ins on settings.coin_universe;
create trigger t_sync_coin_universe_ins
after insert on settings.coin_universe
for each statement execute function settings.trg_coin_universe_sync();

drop trigger if exists t_sync_coin_universe_upd on settings.coin_universe;
create trigger t_sync_coin_universe_upd
after update on settings.coin_universe
for each statement execute function settings.trg_coin_universe_sync();

drop trigger if exists t_sync_coin_universe_del on settings.coin_universe;
create trigger t_sync_coin_universe_del
after delete on settings.coin_universe
for each statement execute function settings.trg_coin_universe_sync();

-- ─────────────────────────────────────────────────────────────────────────────
-- B) Ingestion surface: what to subscribe to

-- Enabled symbols with their base/quote (single source: settings)
create or replace view str_aux.v_ingest_targets as
select cu.symbol, cu.base_asset, cu.quote_asset
from settings.coin_universe cu
where cu.enabled is true
order by cu.symbol;

-- “Need attention” list: no sample in N secs (default 20s)
create or replace function str_aux.v_needed_samples(_stale_secs int default 20)
returns table(symbol text, last_sample_ts timestamptz) language sql stable as $$
  with t as (
    select symbol from settings.coin_universe where enabled
  ),
  ls as (
    select symbol, max(ts) last_ts
    from str_aux.samples_5s
    group by symbol
  )
  select t.symbol, ls.last_ts
  from t
  left join ls using(symbol)
  where coalesce(extract(epoch from (now() - ls.last_ts))::int, 999999) > _stale_secs
  order by t.symbol;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C) Roll helpers across *all* enabled symbols (batch/scheduler-friendly)

create or replace function str_aux.roll_all_cycles_between(
  _from timestamptz, _to timestamptz, _spec_label text default 'default', _user_id uuid default null
) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select symbol from settings.coin_universe where enabled loop
    n := n + str_aux.roll_cycles_40s_between(r.symbol, _from, _to, _spec_label, _user_id);
  end loop;
  return n;
end$$;

create or replace function str_aux.try_roll_all_windows_now_for_all(
  _spec_label text default 'default',
  _user_id uuid default null
) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select symbol from settings.coin_universe where enabled loop
    n := n + str_aux.try_roll_all_windows_now(r.symbol, _spec_label, _user_id);
  end loop;
  return n;
end$$;

-- Convenience: a one-call “tick” that refreshes windows for everything
create or replace function str_aux.tick_all()
returns void language plpgsql as $$
begin
  perform str_aux.try_roll_all_windows_now_for_all();
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D) Grants (daemon usually runs as cp_writer)
do $$
begin
  perform 1 from pg_roles where rolname='cp_writer';
  if found then
    grant select on str_aux.v_ingest_targets to cp_writer;
    grant execute on function str_aux.v_needed_samples(int) to cp_writer;
    grant execute on function str_aux.roll_all_cycles_between(timestamptz, timestamptz, text, uuid) to cp_writer;
    grant execute on function str_aux.try_roll_all_windows_now_for_all(text, uuid) to cp_writer;
    grant execute on function str_aux.tick_all() to cp_writer;
  end if;
end$$;
