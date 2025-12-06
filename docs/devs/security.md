# Security (Dev-Facing, Non-Sensitive)

High-level model; no secrets or internal identifiers are disclosed.

## Principles
- Hash everything user-facing (passwords, invite tokens, session tokens). Never store plain tokens.
- Least privilege: separate roles for admin, writers, readers, and jobs. RLS enforces per-user data isolation.
- Boundaries: public routes return only what is needed; internal identifiers are never exposed in docs or UI.

## Auth & sessions
- Invites are single-use and bound to the invited email; links are `/auth/invite/<token>`.
- Registration shows the invited email read-only; passwords must meet minimum length.
- Session cookies are HTTP-only, scoped to the app host; only token hashes are persisted server-side.

## Data protection
- User-specific settings, wallets, and invites are partitioned via RLS and role grants.
- Exchange credentials (if present) are encrypted/hashed; plain values are not retained.
- Logs should avoid sensitive payloads; prefer IDs/timestamps over contents.

## Delivery posture
- Keep env secrets out of git; use environment-specific secret stores.
- Cookie domain/BASE_URL must match the host to avoid cookie leakage across domains.
- Public-facing docs avoid schema names, function names, and table names.
