# CryptoPi Dynamics — Whitepaper (Public-Facing, Non-Sensitive)

This document summarizes the intent, mechanics, and safeguards of CryptoPi Dynamics without disclosing proprietary identifiers or secrets. It is safe to share externally.

## Purpose
- Provide real-time and near-real-time views of market microstructure across a curated coin universe.
- Surface actionable “matrix” snapshots and auxiliary samplers (STR-AUX, CIN-AUX) built on simple, explainable math.
- Maintain user-specific state (settings, preferences, wallets) with clear separation between accounts.

## Core pillars
- **Transparency over novelty**: Calculations favor basic ratios, deltas, and small-signal thresholds over opaque modeling.
- **Freshness with fallback**: Live reads are attempted first; cached snapshots bridge gaps when upstream data is slow.
- **Safety-first auth**: Tokens and passwords are hashed; invites are single-use; session cookies are scoped to the app host.
- **Least-privilege data handling**: Per-user settings and auth data are isolated through role/rule segmentation at the data layer.

## Data & sampling
- **Samplers (e.g., STR-AUX)**: Pull orderbook/price ticks into in-memory buffers, grouped by time windows. Buffers operate as “1-in / 1-out” rings to keep a fixed-size recent history. If a process restarts, buffers rehydrate from scratch and warm up quickly.
- **Matrices**: Constructed from spot pairs normalized to a common quote. Metrics include:
  - Benchmark ratio: `base/quote` (green when >1, red when <1, neutral near 1).
  - Percent change: `(latest / first) - 1` over fixed windows (15m/30m/1h).
  - Idiosyncratic %: ratio deltas with a small epsilon to avoid divide-by-zero.
  - Frozen flags: values that remain within tiny deltas (e.g., `1e-7`) across polls to reduce flicker.
  - Mood rollups: averages, bucket counts (positive/negative/neutral), and span (max-min). No advanced statistics.
 

 ### Wrong ^^^
 
## Settings & universe
- Coin universe is normalized (uppercase, deduped); USDT is always present. Invalid input falls back to previous values.
- Universe sync creates valid spot symbols and can disable missing entries when requested.
- Timing knobs (auto-refresh, poll cycles) are user-configurable and persisted per account.

## Auth & invites
- Invites are single-use, bound to the invited email, and delivered as `/auth/invite/<token>` links.
- Registration shows the invited email as read-only and requires a password meeting minimum strength.
- Session tokens are opaque; only hashes are stored. Cookies are HTTP-only and can be scoped to a subdomain via environment configuration.

## Security posture (high level)
- Hashing for tokens/passwords; no plain secrets are stored.
- Role-based separation at the data layer; rows and operations are partitioned by role and session context.
- Minimal exposure: public docs and UI copy avoid internal identifiers, table names, or stored procedure names.

## Resilience & recovery
- Live endpoints have short timeouts and fall back to the most recent snapshot.
- Interruptions in samplers trigger buffer rebuilds; downstream views recover after a brief warm-up.
- Backups and recovery routines exist at the ops layer; see dev-facing docs for process (details are environment-specific).

## Roadmap themes (illustrative)
- Richer audit surfaces (user-facing and admin-facing).
- Expanded samplers with configurable windows.
- UX refinements for invite flows and settings validation.
- Additional health and status signals for operators.
