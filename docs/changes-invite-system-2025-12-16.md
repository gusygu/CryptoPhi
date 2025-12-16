# Invite System & Mail Updates (2025-12-16)

This document summarizes the changes made in the latest task to stabilize invites and admin mail flows.

## Database
- Added compatibility migration `src/core/db/migrations/999_invites_compat.sql` to guarantee `admin.invites` exists or points to a compatible view and to expose `admin.v_invites_compat` with normalized columns.
- Added hardening DDLs (`src/core/db/ddl/101_invites_quota.sql`, `102_invites_table_hardening.sql`) to backfill missing invite columns, indexes, and constraints.
- Introduced a lightweight migrations runner `src/scripts/db/run-migrations.mts` with package scripts `db:migrate` / `run-migrations` to apply files under `src/core/db/migrations`.

## Server/API
- New JSON helpers under `src/app/api/_lib/responses.ts` to standardize success/error responses and disable caching.
- Added API routes:
  - `/api/invite/list` (admin) for listing invites.
  - `/api/admin/invites/link` to generate invite links.
  - `/api/admin/mail/templates`, `/api/admin/mail/invite/stats`, `/api/admin/mail/invite/link`, `/api/admin/mail/invite/send` for mail/comms.
  - Compat wrappers for `/api/invite/approve` and `/api/invite/reject`.
- All routes return JSON `{ ok: true|false, ... }` with `Cache-Control: no-store`.

## Invite Service
- Rebuilt `src/core/features/invites/service.ts` to:
  - Dynamically detect invite table columns (preferring `target_email`) and insert only available fields (status, created_by, roles, token UUID/hash, etc.).
  - Create the compat view at runtime when missing (non-blocking).
  - List invites via `admin.v_invites_compat` with fallback to `admin.invites` if the view is absent.
  - Enforce quotas and hashed token storage while building invite URLs.

## Client/UI Hardening
- Added `src/lib/client/safeJson.ts` to guard against HTML responses and surface readable errors.
- Updated admin invites, admin mail, and mgmt pages to use safe JSON parsing and show structured errors instead of crashing on unexpected content.
- Settings page now accepts Promise-style params to silence Next.js warnings.

## Scripts & Usage
- Apply DDLs: `pnpm run run-ddl` (existing).
- Apply migrations: `pnpm run run-migrations` (new) to run files in `src/core/db/migrations` such as `999_invites_compat.sql`.

## Notes
- If `target_email` is present and NOT NULL, inserts now target that column to avoid constraint failures.
- The compat view keeps reads stable across legacy/new schemas; no changes to auth/session or isolation logic were made.
