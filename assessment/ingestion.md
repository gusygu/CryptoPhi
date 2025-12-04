## Critical ingestion & DB layers

### STR-AUX routes
- `src/app/api/str-aux/sources/ingest/route.ts` (bulk bins ingest)
- `src/app/api/str-aux/sources/ingest/sampling/route.ts`
- `src/app/api/str-aux/sources/ingest/sampling/points/cycle/route.ts`
- `src/app/api/str-aux/sources/ingest/sampling/points/cycle/window/route.ts`
- `src/app/api/str-aux/sources/ingest/bins/route.ts`
- `src/app/api/str-aux/vectors/route.ts` (feeds logs via `insertStrSamplingLog`)
- Support helpers:
  - `src/lib/server/audit-log.ts`
  - `src/core/features/str-aux/ingest.ts`
  - `src/core/features/str-aux/sampling/*`
  - `src/core/features/str-aux/frame/*`

### Matrices
- Legacy commit handler parked in `assessment/matrices_commit`.
- Active matrix exposure:
  - `src/app/api/matrices/latest/route.ts`
  - `src/app/api/matrices/route.ts`
  - `src/app/api/matrices/server/route.ts`
- Something will need to replace `matrices/commit` when rebuilt.

### CIN-AUX runtime
- `src/app/api/cin-aux/runtime/sessions/route.ts`
- `src/app/api/cin-aux/runtime/sessions/[sessionId]/balances|close|moves|prices/refresh|rollup|tau|tau/assets|trades/sync|wallet/ingest`
- Repo/helpers under `src/core/features/cin-aux/**` (legacy + new)

### OPS / pipeline / poller
- `src/app/api/ops/place/route.ts` (ledger inserts)
- Pipeline orchestration (`src/app/api/pipeline/**`)
- Poller client (`src/lib/pollerClient.ts`) & route (legacy copy under `assessment/poller_index.ts`)

### Settings / system
- Not touched in this phase but they feed ingestion: `src/app/api/settings/route.ts` and `src/app/api/system/**`

### DB helpers
- Pool + session helpers (`src/core/db/pool_server.ts`, `src/core/db/session.ts`)
- Audit log (`src/lib/server/audit-log.ts`)
- Notification hooks (e.g., `src/core/notifications/*`)
