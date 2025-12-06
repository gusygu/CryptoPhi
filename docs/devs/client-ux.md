# Client UX (Full Notes for Devs)

Comprehensive view of client-facing semantics.

## Matrices & Dynamics
- **Payload**: `/api/matrices/latest` returns `ok`, `coins`, `symbols`, `quote`, window (15m/30m/1h), matrices (benchmark, pct24h, id_pct, pct_drv, pct_ref, ref, pct_snap, snap, delta), flags, and timestamps.
- **Colors**: basic ratios and deltas; zero floors avoid flicker (`1e-7` decimals, ~`0.0005` percents). Benchmark >1 = green, <1 = red; near-flat = neutral. Frozen flags indicate consecutive near-equal readings.
- **Mood**: average `id_pct`, bucket counts, span, dominance (simple arithmetic). No advanced stats.

## STR-AUX / CIN-AUX
- Live samplers buffered in-memory; “1-in / 1-out” keeps fixed-size recency. Restarting samplers wipes buffers; they warm up on resume.
- UI should hint when sampler is warming up vs steady.

## Settings UI
- **Universe**: Uppercase, deduped; USDT auto-included. Invalid input preserves last good state.
- **Timing**: Auto-refresh, secondary cycles, poll intervals; apply bounds to avoid overload (e.g., min 500ms, reasonable caps).
- **Params**: cadence, k-size, sensitivities, id_pct thresholds; check for finite numbers.
- **Profile/Wallets**: Wallet add/remove are server actions; addresses/networks are validated lightly and stored per user.

## Invites
- One personal invite per user. Link format: `/auth/invite/<token>`, redirecting to register with the invite pre-filled. Email is read-only during registration.
- Error paths: invalid/used invite → `/auth?err=invalid_or_used_invite`; weak/mismatch passwords short-circuit.

## Usability cues
- Refresh buttons + auto-refresh toggles; surface error banners when payload `ok` is false.
- Status/mood badges show text labels and color-coded accents; avoid over-animating to keep it legible.

## Data/State handling
- Settings provider hydrates from cookie/local storage, then reconciles with `/api/settings`.
- Persist to server first; re-fetch to mirror any normalization done server-side.
- Broadcast custom events for downstream listeners (`app-settings:updated`, `coins-changed`, etc.).
