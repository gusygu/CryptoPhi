-- 23_settings_user_space.sql
-- Per-user/app-session settings extracted from legacy 02_settings.sql.

BEGIN;
SET search_path = settings, public;

/* -------------------------------------------------------------------------- */
/* A) Personal time settings (per app session / user)                         */
/* -------------------------------------------------------------------------- */

create table if not exists personal_time_settings (
  app_session_id   text primary key,
  cycle_seconds    int    not null default 80,
  sampling_seconds int,
  window_seconds   int,
  meta             jsonb  not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  constraint chk_cycle_seconds_positive check (cycle_seconds > 0),
  constraint chk_sampling_seconds_positive check (sampling_seconds is null or sampling_seconds > 0),
  constraint chk_window_seconds_positive check (window_seconds is null or window_seconds > 0)
);

create or replace function settings.sp_upsert_personal_time_setting(
  _app_session_id   text,
  _cycle_seconds    int,
  _sampling_seconds int default null,
  _window_seconds   int default null,
  _meta             jsonb default '{}'::jsonb
) returns void language sql as $$
  insert into settings.personal_time_settings(app_session_id, cycle_seconds, sampling_seconds, window_seconds, meta, updated_at)
  values(_app_session_id, greatest(1, _cycle_seconds), _sampling_seconds, _window_seconds, coalesce(_meta,'{}'::jsonb), now())
  on conflict (app_session_id) do update
    set cycle_seconds    = greatest(1, excluded.cycle_seconds),
        sampling_seconds = excluded.sampling_seconds,
        window_seconds   = excluded.window_seconds,
        meta             = excluded.meta,
        updated_at       = now();
$$;

-- RLS: rows are visible/writable only to matching session; global rows (NULL/'global') are readable by all
alter table if exists settings.personal_time_settings enable row level security;

do $$
declare
  pol_r text := 'personal_time_settings_r';
  pol_w text := 'personal_time_settings_w';
  tgt_read text := 'PUBLIC';
  tgt_write text := 'PUBLIC';
  cur_expr text := 'coalesce(current_setting(''app.current_session_id'', true), '''')';
begin
  if exists (select 1 from pg_roles where rolname = 'cp_reader')
     and exists (select 1 from pg_roles where rolname = 'cp_app')
     and exists (select 1 from pg_roles where rolname = 'cp_writer')
     and exists (select 1 from pg_roles where rolname = 'cp_admin') then
    tgt_read  := 'cp_reader, cp_app, cp_writer, cp_admin';
    tgt_write := 'cp_app, cp_writer, cp_admin';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'settings' and tablename = 'personal_time_settings' and policyname = pol_r
  ) then
    execute format(
      'create policy %I on settings.personal_time_settings
         for select
         to %s
         using (app_session_id is null or app_session_id = %s or app_session_id = %L)',
      pol_r, tgt_read, cur_expr, 'global'
    );
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'settings' and tablename = 'personal_time_settings' and policyname = pol_w
  ) then
    execute format(
      'create policy %I on settings.personal_time_settings
         for all
         to %s
         using (app_session_id is null or app_session_id = %s or app_session_id = %L)
         with check (app_session_id is null or app_session_id = %s or app_session_id = %L)',
      pol_w, tgt_write, cur_expr, 'global', cur_expr, 'global'
    );
  end if;
end$$;

insert into settings.personal_time_settings(app_session_id, cycle_seconds)
values ('global', 80)
on conflict (app_session_id) do nothing;

/* -------------------------------------------------------------------------- */
/* B) User-scoped coin universe                                               */
/* -------------------------------------------------------------------------- */

create table if not exists coin_universe_user (
  user_id     uuid not null,
  symbol      text not null,
  enabled     boolean not null default true,
  sort_order  integer,
  base_asset  text,
  quote_asset text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, symbol)
);

create index if not exists ix_coin_universe_user_enabled on coin_universe_user(user_id, enabled);

-- RLS: users can only see / mutate their own rows
alter table if exists settings.coin_universe_user enable row level security;

do $$
declare
  pol_r text := 'coin_universe_user_r';
  pol_w text := 'coin_universe_user_w';
  tgt_read text := 'PUBLIC';
  tgt_write text := 'PUBLIC';
  cur_expr text := 'nullif(current_setting(''app.current_user_id'', true), '''')::uuid';
begin
  if exists (select 1 from pg_roles where rolname = 'cp_reader')
     and exists (select 1 from pg_roles where rolname = 'cp_app')
     and exists (select 1 from pg_roles where rolname = 'cp_writer')
     and exists (select 1 from pg_roles where rolname = 'cp_admin') then
    tgt_read  := 'cp_reader, cp_app, cp_writer, cp_admin';
    tgt_write := 'cp_app, cp_writer, cp_admin';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'settings' and tablename = 'coin_universe_user' and policyname = pol_r
  ) then
    execute format(
      'create policy %I on settings.coin_universe_user
         for select
         to %s
         using (user_id = %s)',
      pol_r, tgt_read, cur_expr
    );
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'settings' and tablename = 'coin_universe_user' and policyname = pol_w
  ) then
    execute format(
      'create policy %I on settings.coin_universe_user
         for all
         to %s
         using (user_id = %s)
         with check (user_id = %s)',
      pol_w, tgt_write, cur_expr, cur_expr
    );
  end if;
end$$;

-- Resolved view: prefer user overrides, otherwise global defaults
-- Ensure global table has columns we reference (idempotent for old schemas)
alter table if exists settings.coin_universe
  add column if not exists sort_order integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace view settings.v_coin_universe_resolved as
with ctx as (
  select nullif(current_setting('app.current_user_id', true), '')::uuid as user_id
),
merged as (
  -- user-specific rows
  select cuu.symbol,
         cuu.base_asset,
         cuu.quote_asset,
         cuu.enabled,
         cuu.sort_order,
         cuu.metadata,
         cuu.user_id
    from settings.coin_universe_user cuu, ctx
   where ctx.user_id is not null
     and cuu.user_id = ctx.user_id

  union all

  -- global rows that aren't overridden
  select cg.symbol,
         cg.base_asset,
         cg.quote_asset,
         cg.enabled,
         cg.sort_order,
         cg.metadata,
         null::uuid as user_id
    from settings.coin_universe cg, ctx
   where not exists (
           select 1
             from settings.coin_universe_user cuu
            where ctx.user_id is not null
              and cuu.user_id = ctx.user_id
              and cuu.symbol = cg.symbol
         )
)
select * from merged;

COMMIT;
