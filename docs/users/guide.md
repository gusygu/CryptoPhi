# CryptoPi Dynamics — User Guide (Concise)

This guide explains how to use the app without exposing sensitive internals. Data you see and configure is tied to your account and stored securely.

## What you need to know about your data
- Your account is keyed by your invite email; the email on the registration screen cannot be changed.
- Credentials (including exchange keys if linked) are encrypted/hashed before storage; plain keys are never kept.
- Your settings (coin universe, timing, params) are tied to your account and persist server-side; UI also caches them in a cookie/local copy for speed.

## App map
- **Home / Vitals**: Health, status, and metronome controls (auto refresh, loop cycle).
- **Matrices**: Grid of pair metrics. Colors are basic math: ratio above 1 skews green, below 1 skews red, near-flat shows neutral. Frozen highlights mean a value stayed effectively unchanged across consecutive polls.
- **Dynamics**: Similar data, arranged for motion/temporal feel; uses the same `/api/matrices/latest` payload under the hood.
- **STR-AUX**: Live sampler view. Sampler buffers are in-memory; if the process restarts, the buffer reloads from zero and warms up again.
- **Settings**:
  - *Universe & Engine*: Set coin universe (USDT always included), histogram length, decimals, epsilon/eta/iota knobs.
  - *Timing*: Auto-refresh cadence and secondary cycles; system poller intervals.
  - *Parameters*: Engine tuning (cadence, k-size, sensitivity, id_pct thresholds, ring flips).
  - *Profile & Wallets*: Nickname/timezone/language and public wallets. Wallet removal is immediate; add/remove are server actions.
- **Invites**: One personal invite. When sent, the email is locked to that invite. Links are single-use.
- **Admin/Mgmt (if permitted)**: Manager tools, audit, and ingest views. Regular users may not see these.

## Backups & recovery (what users should know)
- Operators back up the service database regularly and test restores in non-production.
- If an outage happens, your settings and account state can be restored; you may need to sign in again afterward.

## How matrices are computed (plain math)
- Benchmarks: `base / quote`. Values > 1 mean base stronger; < 1 mean weaker.
- Percent change: `(latest / first) - 1` over the chosen window (15m/30m/1h).
- Idiosyncratic % (`id_pct`): small epsilon is applied to avoid divide-by-zero; flat readings show as neutral.
- Mood: averages of `id_pct` plus simple buckets (positive/negative/neutral) and span (max-min). No advanced stats involved.
- Frozen flags: consecutive reads within a tiny delta (e.g., `1e-7`) mark a cell as “frozen” to reduce flicker.

## Practical tips
- If data looks stale, hit Refresh; the app also auto-refreshes based on your Timing settings.
- If you interrupt the app (close tab or service restarts), samplers refill; give them a short warm-up.
- Invites are single-use. If a link says invalid/used, request or send a fresh one.
- Cookies are scoped to the app host; sign in at the same subdomain you received in the invite link (e.g., `app.cryptophi.xyz`).
