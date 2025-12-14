// src/lib/settings/server.ts
"use server";

import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { getCurrentSession, resolveUserSessionForBadge, type UserSession } from "@/app/(server)/auth/session";
import {
  fetchCoinUniverseBases,
  normalizeCoinList,
  syncCoinUniverseFromBases,
  upsertSessionCoinUniverse,
  upsertUserCoinUniverse,
} from "@/lib/settings/coin-universe";
import { DEFAULT_SETTINGS, migrateSettings, type AppSettings } from "./schema";
import { resolveCycleSeconds } from "@/core/settings/time";
import { query, withDbContext } from "@/core/db/pool_server";
import { resolveRequestBadge } from "@/lib/server/badge";

const COOKIE_KEY = "appSettings";
const LEGACY_COOKIE_KEYS = ["cp_settings_v1"];
const ONE_YEAR = 60 * 60 * 24 * 365;
const MAX_COOKIE_BYTES = 2048;

function byteLength(str: string): number {
  return Buffer.byteLength(str, "utf8");
}

function safeSetCookie(
  name: string,
  value: string,
  options: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2],
): boolean {
  const size = byteLength(`${name}=${value}`);
  if (size > MAX_COOKIE_BYTES) {
    console.warn(`[settings] skip set cookie "${name}" size=${size}b (>2KB)`);
    return false;
  }
  cookies().set(name, value, options);
  return true;
}

export async function getAll(opts: {
  client?: PoolClient | null;
  sessionKey?: string | null;
  session?: UserSession | null;
} = {}): Promise<AppSettings> {
  // set request context so DB fetches are user-aware
  const session = opts.session ?? (await getCurrentSession());
  // badge/app_session_id: prefer request badge, fall back to global
  const sessionKey = opts.sessionKey ?? (await resolveRequestBadge({ defaultToGlobal: false }));
  if (!sessionKey) {
    throw new Error("missing_session");
  }
  const jar = await cookies();
  const cookieName = `${COOKIE_KEY}_${sessionKey}`;
  const existing = jar.get(cookieName)?.value ?? null;
  if (existing && byteLength(`${cookieName}=${existing}`) > MAX_COOKIE_BYTES) {
    jar.set(cookieName, "", { path: "/", maxAge: 0, sameSite: "lax" });
  }
  for (const legacy of LEGACY_COOKIE_KEYS) {
    const val = jar.get(legacy)?.value ?? null;
    if (val && byteLength(`${legacy}=${val}`) > MAX_COOKIE_BYTES) {
      jar.set(legacy, "", { path: "/", maxAge: 0, sameSite: "lax" });
    }
  }
  const settings = migrateSettings(DEFAULT_SETTINGS);
  try {
    const cycleSeconds = await resolveCycleSeconds(sessionKey, opts.client);
    settings.timing.autoRefreshMs = Math.max(1_000, cycleSeconds * 1_000);
  } catch {
    // keep migrated value on failure
  }
  const userCoinsFromCookie = normalizeCoinList(settings.coinUniverse);
  const dbCoins = await fetchCoinUniverseBases(
    { onlyEnabled: true, context: session ? { userId: session.userId, sessionId: sessionKey, isAdmin: session.isAdmin } : undefined },
    opts.client,
  );
  // Prefer DB (user overrides resolved by view) then cookie, then defaults.
  settings.coinUniverse =
    dbCoins.length
      ? dbCoins
      : userCoinsFromCookie.length
      ? userCoinsFromCookie
      : normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
  return settings;
}

export async function serializeSettingsCookie(
  nextValue: unknown,
  opts: { client?: PoolClient | null; session?: UserSession | null; sessionKey?: string | null } = {},
): Promise<{
  settings: AppSettings;
  cookie: { name: string; value: string; options: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2] };
  persistedCoinUniverse?: string[];
}> {
  const client = opts.client ?? null;
  const session = opts.session ?? (await getCurrentSession());
  const isAdmin = !!session?.isAdmin;
  const sessionKey = opts.sessionKey ?? (await resolveRequestBadge({ defaultToGlobal: false }));
  if (!sessionKey) {
    throw new Error("missing_session");
  }
  const current = await getAll({ client, session, sessionKey });
  const merged = migrateSettings({ ...current, ...(nextValue as any) });

  // Sync universe: admins affect global, regular users write per-session overrides.
  if (isAdmin) {
    const normalizedCoins = normalizeCoinList(merged.coinUniverse);
    await syncCoinUniverseFromBases(normalizedCoins, client);
    // Also persist per-user + per-session rows so admin reads resolve via RLS views.
    if (session?.userId) {
      await upsertUserCoinUniverse(
        session.userId,
        normalizedCoins,
        { enable: true, autoDisable: true },
        client ?? undefined,
      );
      await upsertSessionCoinUniverse(
        sessionKey,
        normalizedCoins,
        { enable: true, context: { userId: session.userId, isAdmin: session.isAdmin } },
        client ?? undefined,
      );
    }
    merged.coinUniverse = normalizedCoins;
  } else {
    const { persistedSymbols } = await upsertSessionCoinUniverse(
      sessionKey,
      normalizeCoinList(merged.coinUniverse),
      { enable: true, context: session ? { userId: session.userId, isAdmin: session.isAdmin } : undefined },
      client,
    );
    // Use persisted list (read-after-write) to reflect DB state in response/cookie.
    const persistedCoins = normalizeCoinList(
      persistedSymbols.map((sym) =>
        sym?.toUpperCase().endsWith("USDT") ? sym.toUpperCase().slice(0, -4) : sym.toUpperCase(),
      ),
    );
    merged.coinUniverse = persistedCoins;
  }

  const normalized: AppSettings = {
    ...merged,
    coinUniverse: normalizeCoinList(merged.coinUniverse),
  };

  const value = JSON.stringify({ version: 1, badge: sessionKey });
  const cookieName = `${COOKIE_KEY}_${sessionKey || "global"}`;
  const cookie = {
    name: cookieName,
    value,
    options: {
      httpOnly: false,
      sameSite: "lax" as const,
      path: `/`,
      maxAge: ONE_YEAR,
      // host-only cookie; not scoped to a shared domain
    },
  };

  // persist timing into DB (global/app-session scoped)
  const cycleSeconds = Math.max(1, Math.round(normalized.timing.autoRefreshMs / 1000));
  const ctx = session
    ? { sessionId: sessionKey, userId: session.userId, isAdmin }
    : null;
  try {
    if (client && ctx) {
      await client.query(`select user_space.sp_upsert_poller_time($1)`, [cycleSeconds]);
    } else if (ctx) {
      await withDbContext(ctx, (c) => c.query(`select user_space.sp_upsert_poller_time($1)`, [cycleSeconds]));
    }
  } catch {
    // best-effort; ignore DB failures for cookie writes
  }

  // persist per-user params into user_space.params (RLS via current_user_id)
  try {
    const params = [
      normalized.timing.autoRefreshMs,                    // primary_interval_ms
      normalized.timing.secondaryEnabled,                 // secondary_enabled
      normalized.timing.secondaryCycles,                  // secondary_cycles
      normalized.timing.strCycles.m30,                    // str_cycles_m30
      normalized.timing.strCycles.h1,                     // str_cycles_h1
      normalized.timing.strCycles.h3,                     // str_cycles_h3
      normalized.params.values.epsilon ?? null,           // epsilon override
    ];
    if (client && ctx) {
      await client.query(`select user_space.sp_upsert_params($1,$2,$3,$4,$5,$6,$7)`, params);
    } else if (ctx) {
      await withDbContext(ctx, (c) => c.query(`select user_space.sp_upsert_params($1,$2,$3,$4,$5,$6,$7)`, params));
    }
  } catch {
    // best-effort; ignore DB failures for cookie writes
  }

  return { settings: normalized, cookie, persistedCoinUniverse: normalized.coinUniverse };
}

export async function setAll(nextValue: unknown): Promise<AppSettings> {
  const { settings, cookie } = await serializeSettingsCookie(nextValue);
  safeSetCookie(cookie.name, cookie.value, cookie.options);

  return settings;
}

// Canonical helper to resolve effective settings for a given user/badge context.
// Prefer passing both userId and badge (sessionId) to avoid leaking another user's universe.
export async function getEffectiveSettings(params: {
  userId?: string | null;
  badge: string;
  client?: PoolClient | null;
}): Promise<AppSettings> {
  const sessionId = (params.badge ?? "").trim();
  if (!sessionId) throw new Error("missing_session");

  const resolved = params.userId
    ? { userId: params.userId, isAdmin: false }
    : await resolveUserSessionForBadge(sessionId);

  const userId = resolved?.userId ?? null;
  const isAdmin = !!resolved?.isAdmin;

  // Use the existing universe resolver with explicit context
  const coinUniverse = await resolveCoinsFromSettings({
    userId,
    sessionId,
    client: params.client ?? null,
  });

  // Fall back to the default settings for non-universe fields
  const base = migrateSettings(DEFAULT_SETTINGS);
  return {
    ...base,
    coinUniverse,
  };
}

export async function getEffectiveUniverseForUser(opts: {
  userId: string;
  sessionId: string;
  isAdmin?: boolean;
  client?: PoolClient | null;
}): Promise<string[]> {
  const ctx = { userId: opts.userId, sessionId: opts.sessionId, isAdmin: !!opts.isAdmin };
  const bases = await fetchCoinUniverseBases(
    { onlyEnabled: true, context: ctx },
    opts.client ?? null,
  );
  const normalized = normalizeCoinList(bases);
  if (!normalized.includes("USDT")) normalized.push("USDT");
  return normalized;
}

export async function resolveCoinsFromSettings(
  opts: { userId?: string | null; sessionId?: string | null; client?: PoolClient | null } = {},
): Promise<string[]> {
  let userId = opts.userId ?? null;
  const sessionId = opts.sessionId ?? null;
  let isAdmin = false;

  if (sessionId && !userId) {
    const resolved = await resolveUserSessionForBadge(sessionId);
    if (resolved) {
      userId = resolved.userId;
      isAdmin = resolved.isAdmin;
    } else {
      return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
    }
  }

  if (userId && sessionId) {
    try {
      return await getEffectiveUniverseForUser({
        userId,
        sessionId,
        isAdmin,
        client: opts.client ?? null,
      });
    } catch {
      /* fall back to defaults below */
    }
    return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
  }

  if (sessionId && !userId) {
    return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
  }

  // ensure user context is attached so DB view returns per-user rows (only when badge not forced)
  const session = await getCurrentSession();
  const badge = await resolveRequestBadge({ defaultToGlobal: false });
  const dbCoins =
    session && badge
      ? await fetchCoinUniverseBases(
          { onlyEnabled: true, context: { userId: session.userId, sessionId: badge, isAdmin: session.isAdmin } },
          opts.client ?? null,
        )
      : [];
  if (dbCoins.length) return dbCoins;
  return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
}

export async function getEffectiveSettingsForBadge(badge: string): Promise<{
  badge: string;
  settings: AppSettings;
  session: UserSession & { resolvedFromSessionMap?: boolean };
}> {
  const sessionId = (badge ?? "").trim();
  const resolved = await resolveUserSessionForBadge(sessionId);
  if (!resolved) {
    throw new Error("unknown_badge");
  }
  const settings = await getAll({ sessionKey: sessionId, session: resolved });
  return { badge: sessionId, settings, session: resolved };
}

/** Legacy alias kept for older imports. */
export async function getSettingsServer() {
  return getAll();
}
