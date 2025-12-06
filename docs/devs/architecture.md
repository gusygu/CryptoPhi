# Architecture & Data Flows (Developer Notes)

This document outlines the core moving parts for contributors. It intentionally avoids schema names, secrets, and proprietary labels while describing how things hang together.

## Runtime shape
- **App shell**: Next.js app with server actions plus a client settings provider (cookies + local storage) to hydrate UI defaults.
- **API surface**: REST-style routes for matrices, preview data, invites, auth, and settings. Server actions back most forms.
- **Persistence**: Postgres-backed, but treat it as a black box here—API routes abstract all access. No tables or functions are listed to keep sensitive naming out of docs.
- **Sessions**: Cookies hold opaque session tokens; the server stores only hashed tokens. Session cookies can be scoped to a subdomain via env (see `COOKIE_DOMAIN` / `BASE_URL`).

## Sampling & matrices
- **Orderbook sampling (STR-AUX)**: A lightweight sampler consumes exchange data, batches ticks into time buckets, and maintains a rolling buffer. Think “1-in / 1-out”: each new sample pushes the oldest out after a cycle completes, keeping the buffer warm without overgrowth.
- **Matrices build**: Matrices assemble simple derived metrics (ratios and deltas), not advanced math. Typical steps:
  - Normalize pairs to a single quote.
  - Compute benchmark ratios (`base/quote`) and treat near-flat values as zero floor (e.g., `1e-7`) to avoid noise.
  - Percent change over windows (15m/30m/1h) uses `(last / first) - 1`.
  - Idiosyncratic % (`id_pct`) uses a small epsilon to avoid divide-by-zero; frozen flags mark values that stayed stable across consecutive pulls.
  - “Mood” summaries are just averages and simple bucket counts (positive/negative/neutral) plus min/max span.
- **Live vs stored**: When live calls time out, the API falls back to the latest stored snapshot; flags indicate what was live vs cached.

## Auth & invites
- **Credentials**: Passwords hashed with a strong KDF; tokens/invites hashed with SHA-256 before storage. Plain tokens appear only in the user-facing link.
- **Invite flow**: A one-time token URL (`/auth/invite/<token>`) bridges to registration. Tokens are single-use and bound to the invited email; the email is displayed read-only during registration.
- **Sessions**: On login/registration, a session token is issued, hashed server-side, and set as an HTTP-only cookie.

## Settings & universe
- **Coin universe**: Normalized to uppercase, deduped, and USDT is always present. Missing/malformed inputs keep prior values to avoid breaking consumers.
- **Sync to market symbols**: After saving the universe, a sync step rebuilds valid spot pairs and can disable missing entries when asked.

## Failure handling
- **API retries**: Matrix routes first try live sources with a short timeout, then fall back. Errors surface as JSON `{ ok: false, error }`.
- **Sampling gaps**: If samplers are interrupted, buffers refill from scratch on restart; expect a short warm-up period.
- **Invite errors**: Already-used or expired tokens redirect to `/auth?err=invalid_or_used_invite`; weak/mismatched passwords short-circuit on the server action.

## Deployment knobs
- `BASE_URL` (and optional `COOKIE_DOMAIN`) must match the host serving invites/auth so cookies and links work across subdomains.
- Avoid leaking secrets: all docs and UI copy should describe behavior, not internal identifiers or schema names.
