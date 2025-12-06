# Database (High-Level, Non-Sensitive)

This file gives contributors a big-picture view of the DB layer without leaking names of tables, roles, or procedures. Replace placeholders with environment-specific notes offline if needed.

## Broad structure
- **Schemas**: Segmented by domain (auth, market data, matrices/aux, ops/audit). Treat schema names as conceptual, not canonical.
- **Views**: Read-only projections to simplify UI/API consumption (e.g., latest snapshots, combined health/status). No sensitive names are listed here.
- **Functions**: Used for ingest, sync, and housekeeping. Avoid mentioning identifiers in public docs.

## DDL order (conceptual)
1) Core domain tables (markets, matrices/aux).
2) Auth + invites + sessions.
3) Ops/audit tables and enums.
4) RLS/role grants.
5) Optional helper views.

## Migrations
- Use ordered packs/migrations to stay idempotent in dev/stage.
- Safeguards (e.g., existence checks) prevent accidental double-creates.
- Never run destructive migrations on shared environments without a snapshot/backup.

## Roles & RLS (generic description)
- Roles are split into: **admin**, **app-writer**, **app-reader**, **job/worker**, **read-only**.
- RLS gates rows by session context and role. User-specific data (settings, wallets, invites, sessions) is isolated so one user cannot read another’s data.
- Application sessions set a per-request/session identifier that RLS policies use to scope reads/writes.

## “Broad DB structure” for orientation
- **Auth**: users, invites, sessions; hashed tokens only; single-use invite tokens.
- **Market data**: symbols, ticks/klines/orderbooks (ingest → projections).
- **Matrices/Aux**: computed grids, sampler outputs, snapshots, and flags.
- **Ops/Audit**: action logs, status/health, mail queue, timers.

## Backups & recovery (pointer)
- See `docs/devs/operations.md` for the process and expectations; do not store connection strings or credentials here.
