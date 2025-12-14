# Cookies, badge routing, and DB policy (current state)

## Request / user-context flow
- Login/register (`src/lib/auth/server.ts#createSession`) issues `session` (HttpOnly) and `sessionId` (badge), writes the token hash to `auth.session`, and upserts badge -> user into `user_space.session_map`.
- Server actions that call `getCurrentSession`/`requireUserSession` ensure the badge cookie exists, adopt it into AsyncLocalStorage, and set the DB context before queries.
- Middleware (`src/middleware.ts`) rewrites non-auth pages to `/{badge}/...` and sets `x-app-session` for API routes using query/header/cookie fallbacks; defaults to `global`.
- The PG pool (`src/core/db/pool_server.ts`) reads the badge + user context to set `app.current_user_id` and `app.current_session_id` via `auth.set_request_context`, resolving user_id from `user_space.session_map` when only a badge is present. RLS'd tables/views depend on those GUCs.
- API routes propagate the badge/app_session_id into DB fetches and writes (e.g., matrices latest, STR-AUX latest, settings APIs) so cached/live data stays per-session; `global` is the fallback badge.

## Badge contract (strict, Jan 2026)
- Source of truth: `params.badge` for both pages and API routes. The literal string `"api"` or an empty badge is rejected.
- API auth helpers: `requireUserSessionApi(badge)` always returns JSON-friendly `{ok:false,status,body}` on failure (no redirects). It binds the badge to the logged-in user (upserts `user_space.session_map`), rejects if the badge is owned by another user, and logs a structured line with request metadata. Pages use `requireUserSessionPage(badge)` (redirect-capable) to keep server actions/components safe.
- Mapping is single-owner: after login, a badge is bound to exactly one user. Requests with a different user's badge return `403 badge_not_owned` (API) or redirect with `err=badge_not_owned` (pages).
- DB context is set with `withDbContext({ userId, sessionId })`, which sets `app.user_id`/`app.session_id` (transaction-local) and asserts the DB sees the expected values on the same connection. No user-space query is allowed to run with `session_id='api'` or empty.
- Debugging: `/api/[badge]/debug/context` returns badge inputs and the DB-observed `current_setting` values plus backend PID/txid to verify per-request scoping.

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

## Recent context hardening (Dec 2025)
To close the session/GUC gap, we (1) enforced a server-set `sessionId` badge immediately after login and on first authenticated requests (`src/lib/auth/server.ts`, `src/app/(server)/auth/session.ts`), (2) rewired DB access to accept an explicit `{ userId, sessionId, isAdmin }` request context and always call `auth.set_request_context` on the same `PoolClient` before any query, asserting the GUCs are present (`src/core/db/pool_server.ts`), (3) removed cookie/header reads from the DB layer to prevent request-scope crashes, (4) required badge propagation via route param/cookie/header for APIs and kept redirects badge-scoped so settings saves stay in `/[badge]/...`, (5) awaited dynamic params per Next 15 in route handlers/pages, and (6) added a temporary debug endpoint to report badge sources and DB GUCs for verification. These steps stop authenticated flows from silently falling back to the global context and ensure session-scoped writes (e.g., coin universe) persist under the correct badge.
