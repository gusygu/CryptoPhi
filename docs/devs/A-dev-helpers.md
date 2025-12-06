# Dev Helpers (Section A)

Quick pointers for contributors. Keep commands/paths high level; store environment specifics elsewhere.

## Local setup (outline)
- Install Node + package manager; install deps (`pnpm install` or equivalent).
- Copy `.env.example` to `.env` and fill env vars (no secrets in git).
- Start dev server (`pnpm dev` or equivalent) and instrumentation if needed.

## Debugging hints
- Matrices issues: check `/api/matrices/latest` directly; confirm live vs cached paths.
- Invite/auth issues: verify `BASE_URL`/`COOKIE_DOMAIN`, ensure single-use tokens, and watch server-action redirects.
- Samplers: if data is frozen, confirm ingest/upstream market API; sampler restart implies warm-up time.

## Testing/smokes (describe only)
- Hit health/status endpoints.
- Exercise invite -> register -> login.
- Verify matrices render and auto-refresh per settings.

## Style/UI notes
- Keep UI cues legible; avoid over-animation.
- Use zero floors and frozen flags to reduce flicker on small deltas.
