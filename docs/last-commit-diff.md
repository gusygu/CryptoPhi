# Diff vs HEAD (1adbb03)

Scope: compares the current working tree against HEAD `1adbb03` (“Improve matrix coloring logic and ring cues”).

- API routing & badges
- New middleware in `src/middleware.ts` rewrites `/api` traffic into `/api/engine/...` (global) or `/api/{badge}/...` (user-scoped), stamping `x-app-session` headers. Legacy routes under `src/app/api/*` were removed and replaced by new trees `src/app/api/engine` (shared) and `src/app/api/[badge]` (badge-scoped); these are currently untracked additions.
  - Frontend code now imports the badge-aware endpoints (e.g., `src/app/dynamics/page.tsx` uses `/api/[badge]/matrices/latest`).

- Database & session context
  - DDL was reorganized: the old `src/core/db/ddl/*.sql` set was removed and replaced with a new pack (`src/core/db/ddl/*.sql`, `src/core/db/ddl.zip`) plus optional top-level `ddl/` lookup. Scripts (`src/scripts/db/*`) now search both locations.
  - New `user_space` views/functions (see `src/core/db/ddl/40_user_space.sql` etc.) provide per-user coin universe overrides, poller timing, and params via `app.current_user_id/app.current_session_id`.
  - Connection defaults changed (port `1027`, db `cryptophi`, password `HwZ`) in `src/core/db/pool_server.ts` and `src/scripts/utils/db.mts`. Pool setup now sets `app.current_session_id` from headers/cookies so DB functions can scope rows per session.
  - Matrix helpers (`src/core/db/db.ts`, `src/core/pipelines/pipeline.db.ts`) now infer `app_session_id` from request headers, store it in `meta`, and use `(ts_ms, matrix_type, base, quote, user_key)` conflicts; snapshot/lookups filter by that session key.

- Matrices, ingestion, and refresh
  - `src/core/system/refresh.ts` builds matrices from DB tickers via new `src/core/features/matrices/liveFromDb.ts` instead of live API calls; all persistence paths accept `appSessionId`.
  - Inflow/ingestion refactor: `src/core/system/inflow.ts` normalizes Binance klines; `src/core/system/tasks.ts` now uses those helpers and `core/sources/binance`. New jobs (`src/scripts/jobs/inflow.ts/.mts`, `src/scripts/jobs/ingest-runner.ts`) wrap these loops.
  - `src/app/(server)/wire-converter.ts` and related queries now scope matrix reads by `APP_SESSION_KEY` to keep per-session data separate.

- Tooling, scripts, and tests
  - `package.json` adds smoke suites for CIN ingestion and matrices plus job runners; `src/scripts/SMOKES.md` documents the new flows. New smoke/job sources live under `src/scripts/smoke/` and `src/scripts/jobs/`.
  - `buildInternalUrl` is async and callers (e.g., admin pages) await the URL before fetches.

- Cleanup / env
  - `.env.dev` was removed; env defaults now live in code. Large deletion of legacy API handlers and DDL (net change ~18k lines removed).

Notes: Many new files (middleware, engine/[badge] API routes, DDL pack, job scripts) are untracked; add them before committing to capture the new routing/session model.
