# Cookies, badge routing, and DB policy (current state)

## Request / user-context flow
- Login/register (`src/lib/auth/server.ts#createSession`) issues `session` (HttpOnly) and `sessionId` (badge), writes the token hash to `auth.session`, and upserts badge -> user into `user_space.session_map`.
- Server actions that call `getCurrentSession`/`requireUserSession` ensure the badge cookie exists, adopt it into AsyncLocalStorage, and set the DB context before queries.
- Middleware (`src/middleware.ts`) rewrites non-auth pages to `/{badge}/...` and sets `x-app-session` for API routes using query/header/cookie fallbacks; defaults to `global`.
- The PG pool (`src/core/db/pool_server.ts`) reads the badge + user context to set `app.current_user_id` and `app.current_session_id` via `auth.set_request_context`, resolving user_id from `user_space.session_map` when only a badge is present. RLS'd tables/views depend on those GUCs.
- API routes propagate the badge/app_session_id into DB fetches and writes (e.g., matrices latest, STR-AUX latest, settings APIs) so cached/live data stays per-session; `global` is the fallback badge.

## Cookie inventory
- `session`: HttpOnly, SameSite=Lax, path=/, host-only (domain unset), TTL 7d. Random token; only SHA-256 hash stored in `auth.session.token_hash`. Deleted + revoked by `clearSessionCookieAndRevoke`.
- `sessionId`: non-HttpOnly badge, SameSite=Lax, path=/, TTL 7d. Set on login and by `ensureAppSessionCookie`; mapped to user in `user_space.session_map` for resolving `app.current_user_id`. Legacy `appSessionId`/`app_session_id` cookies are deleted when seen. Drives routing and scoping but is not an auth credential by itself.
- `appSettings_<badge>`: non-HttpOnly, SameSite=Lax, path=/, max-age 1y. JSON of sanitized settings from `serializeSettingsCookie`; used for SSR hydration and the client `SettingsProvider`. Snapshotted to `settings.cookies`. Writes: admin -> `settings.coin_universe` + poller timings; non-admin -> `user_space.session_coin_universe` and `user_space.params` under the badge/app_session_id context.
- Legacy/aux: `cp_coins`/`cp.coins` (optional coin list for matrices latest); `sponsor` (optional marketing code); per-badge local cookie copies written by `SettingsProvider` for cross-tab/SSR.

## DB policy & storage
- Auth tokens: only hashes stored; invites also hashed. Badge -> user linkage in `user_space.session_map`.
- Session/app context: every query sets `app.current_user_id` and `app.current_session_id`; RLS on `user_space` tables (`params`, `session_coin_universe`, etc.) and views (`user_space.v_coin_universe`, `user_space.v_poller_time`) uses these GUCs.
- Settings snapshots: `settings.cookies` keeps the last emitted `appSettings` payload (best-effort; ignored if table missing).
- Matrices/STR-AUX: badge/app_session_id is passed into DB fetches and cycle document writes so user/badge sessions stay isolated.

## Operational notes
- Cookies are host-only today to avoid domain mismatch; if cross-subdomain is needed, set `COOKIE_DOMAIN`/`BASE_URL` and verify in lower env first.
- Badge/sessionId is not a security boundary; auth depends on the HttpOnly `session` cookie + DB hash check.
- Logging out deletes both cookies and marks the DB session revoked; stray badges without a valid `session` fall back to the anonymous `global` context.
