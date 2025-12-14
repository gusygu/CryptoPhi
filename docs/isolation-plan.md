# Badge Isolation Stabilization Plan

Step 1 — Establish canonical badge-scoped settings resolution  
We introduced `getEffectiveSettings({ userId, badge, client })` to encapsulate fetching per-user, per-badge settings and coin universes so every caller can rely on a single, isolation-safe entry point.

Step 2 — Migrate high-traffic APIs to the canonical helper  
Key badge APIs (`matrices/latest`, `moo-aux`, `str-aux/latest`) now resolve the badge via `resolveBadgeRequestContext`, set DB context, and read coin universes through `getEffectiveSettings`, preventing cross-user leakage.

Step 3 — Remaining routes and pages to migrate (next)  
The next batch will sweep the rest of the badge-scoped routes/pages to use the same helpers and params unwrapping pattern, and to drop any legacy/global settings reads or caches not keyed by `userId:badge`.

Step 4 — Audit remaining badge APIs for canonical helpers (in progress)  
We scanned badge APIs for legacy auth helpers and will migrate remaining routes (cin-aux, trade, system refresh/opening, str-aux stats/vectors/sources, settings) to use `resolveBadgeRequestContext` + `getEffectiveSettings` with scoped DB context and safe params unwrapping.

Step 5 — Trade and system refresh moved to badge context  
Trade and system refresh endpoints now resolve badge/session via `resolveBadgeRequestContext` and execute DB work inside `withDbContext` to keep RLS/scoping intact; remaining str-aux vectors are the last major badge route to migrate.
