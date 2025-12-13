# Recent changes report (2025-12-09)

## API routing & multi-badge support
- Added Next.js middleware (`src/middleware.ts`) that canonicalizes global routes to `/api/engine/<root>` and user/badge routes to `/api/{badge}/...`, pulling the badge/app session from `sessionId` query/header/cookie and forwarding `x-app-session` for downstream handlers.
- All user-scoped APIs now live under `src/app/api/[badge]/...` (legacy endpoints are rewritten), while shared/engine routes moved to `src/app/api/engine/...`.
- System refresh is badge-aware (`src/app/api/[badge]/system/refresh/route.ts`), using the badge both as poller id and `appSessionId` for isolation; client imports updated (`src/app/dynamics/page.tsx`).
- Core DB helpers now auto-read `x-app-session` from headers when normalizing session ids, enabling multiple simultaneous sessions without cross-talk.

## Core & data plane changes
- Pool bootstrap now sets `app.current_user_id` GUC (`src/core/db/pool_server.ts`) to align with new RLS policies.
- Matrices storage is user-aware: `matrices.dyn_values`/`dyn_values_stage` gained `user_id/app_session_id` columns and PK on `(ts_ms, matrix_type, base, quote, user_key)` with supporting indexes (`src/core/db/ddl/42_matrices_core.sql`); runtime functions filter by `app_session_id` and stamp it into `meta` (`src/core/db/db.ts`), and `runSystemRefresh` accepts an `appSessionId` and builds grids from DB tickers via `src/core/features/matrices/liveFromDb.ts`.
- Settings now support per-user universes: `settings.coin_universe_user` + view `settings.v_coin_universe_resolved` with RLS (`src/core/db/ddl/23_settings_user_space.sql`), server helpers (`src/lib/settings/coin-universe.ts`, `src/lib/settings/server.ts`) and the settings API (`src/app/api/settings/route.ts`) upsert per-user overrides while admins still sync global defaults.
- Cycle settings resolve through user-aware view `user_space.v_poller_time` (`src/core/settings/time.ts`), and converters/pipelines were updated to pass `app_session_id` when querying matrices (e.g., `src/app/(server)/wire-converter.ts`).

## DDL layout & tooling
- DDL set was renamed and regrouped under `src/core/db/ddl/` (zipped copy at `src/core/db/ddl.zip`) using domain-based numbering: `01_core_schemas.sql`, `02_core_extensions.sql`, `03_core_types_enums.sql`, `04_core_time_units.sql`, `05_market_core.sql`, `06_ingest_core.sql`, `07_ops_session_stamp.sql`, `08_ops_core.sql`, `09_ops_compat.sql`, `10_settings_system.sql`, `11_admin_core.sql`, … `23_settings_user_space.sql`, `40_user_space.sql`, `42_matrices_core.sql`, `43_str_aux_core.sql`, `49_wallet_core.sql`, `90_rls_policies.sql`, etc.
- DB tooling now prefers a top-level `ddl/` directory (fallback to `src/core/db/ddl`) when applying migrations (`src/core/db/migrate.ts`, `src/scripts/db/run-ddls.mts`); local defaults updated to port `1027` / db `cryptophi`.
- `docs/devs/db-cheatsheet.md` documents the current schema layout, new per-user universe objects, and quick queries.

## UI & other notable tweaks
- Matrix colouring/ring cues were tuned for frozen states and derivation contrast (`src/components/features/matrices/*`, commits `1adbb03`, `9c427eb`).
- Dynamics client import now points at badge-scoped matrices API (`src/app/dynamics/page.tsx`), keeping pages aligned with the new routing.

## Follow-ups to consider
- Apply the new DDL set (including `coin_universe_user`, `v_coin_universe_resolved`, user-space/personal time tables, matrix PK change) to target databases.
- Update callers to hit `/api/{badge}/...` for user-scoped routes and `/api/engine/...` for shared ones; ensure badges/sessionIds are passed so multi-session requests stay isolated.
- Verify pollers/ingest populate `market.ticker_latest`/`ticker_ticks` so `liveFromDbTickers` has data, and confirm new per-user universe flows in the settings API.
