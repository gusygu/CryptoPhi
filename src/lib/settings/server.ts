// src/lib/settings/server.ts
"use server";

import { cookies } from "next/headers";
import { getCurrentSession } from "@/app/(server)/auth/session";
import {
  fetchCoinUniverseBases,
  normalizeCoinList,
  recordSettingsCookieSnapshot,
  syncCoinUniverseFromBases,
  upsertSessionCoinUniverse,
} from "@/lib/settings/coin-universe";
import { DEFAULT_SETTINGS, migrateSettings, type AppSettings } from "./schema";
import { resolveCycleSeconds } from "@/core/settings/time";
import { query, getPool } from "@/core/db/pool_server";
import { resolveRequestBadge } from "@/lib/server/badge";

const COOKIE_KEY = "appSettings";
const LEGACY_COOKIE_KEYS = ["cp_settings_v1"];
const ONE_YEAR = 60 * 60 * 24 * 365;

function safeParseJSON(value: string | undefined | null): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getAll(): Promise<AppSettings> {
  // set request context so DB fetches are user-aware
  const session = await getCurrentSession();
  // badge/app_session_id: prefer request badge, fall back to global
  const sessionKey = await resolveRequestBadge({ defaultToGlobal: false });
  if (!sessionKey) {
    throw new Error("missing_session");
  }
  const cookieName = `${COOKIE_KEY}_${sessionKey}`;

  const jar = await cookies();
  const raw = jar.get(cookieName)?.value;
  const parsed = safeParseJSON(raw);
  const settings = migrateSettings(parsed ?? DEFAULT_SETTINGS);
  try {
    const cycleSeconds = await resolveCycleSeconds(sessionKey);
    settings.timing.autoRefreshMs = Math.max(1_000, cycleSeconds * 1_000);
  } catch {
    // keep migrated value on failure
  }
  const userCoinsFromCookie = normalizeCoinList(settings.coinUniverse);
  const dbCoins = await fetchCoinUniverseBases({ onlyEnabled: true });
  // Prefer DB (user overrides resolved by view) then cookie, then defaults.
  settings.coinUniverse =
    dbCoins.length
      ? dbCoins
      : userCoinsFromCookie.length
      ? userCoinsFromCookie
      : normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
  return settings;
}

export async function serializeSettingsCookie(nextValue: unknown): Promise<{
  settings: AppSettings;
  cookie: { name: string; value: string; options: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2] };
}> {
  const current = await getAll();
  const merged = migrateSettings({ ...current, ...(nextValue as any) });
  const session = await getCurrentSession();
  const isAdmin = !!session?.isAdmin;
  const sessionKey = await resolveRequestBadge({ defaultToGlobal: false });
  if (!sessionKey) {
    throw new Error("missing_session");
  }

  const normalizedCoins = normalizeCoinList(merged.coinUniverse);
  // Sync universe: admins affect global, regular users write per-session overrides.
  if (isAdmin) {
    await syncCoinUniverseFromBases(normalizedCoins);
  } else {
    await upsertSessionCoinUniverse(sessionKey, normalizedCoins, { enable: true });
  }

  const normalized: AppSettings = {
    ...merged,
    coinUniverse: normalizedCoins,
  };

  const value = JSON.stringify(normalized);
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

  await recordSettingsCookieSnapshot(value);
  // persist timing into DB (global/app-session scoped)
  const cycleSeconds = Math.max(1, Math.round(normalized.timing.autoRefreshMs / 1000));
  try {
    if (sessionKey === "global") {
      await query(`select user_space.sp_upsert_poller_time($1)`, [cycleSeconds]);
    } else {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(`select set_config('app.current_session_id', $1, true)`, [sessionKey]);
        await c.query(`select user_space.sp_upsert_poller_time($1)`, [cycleSeconds]);
        await c.query("COMMIT");
      } catch (err) {
        try { await c.query("ROLLBACK"); } catch {}
        throw err;
      } finally {
        c.release();
      }
    }
  } catch {
    // best-effort; ignore DB failures for cookie writes
  }

  // persist per-user params into user_space.params (RLS via current_user_id)
  try {
    await query(
      `select user_space.sp_upsert_params($1,$2,$3,$4,$5,$6,$7)`,
      [
        normalized.timing.autoRefreshMs,                    // primary_interval_ms
        normalized.timing.secondaryEnabled,                 // secondary_enabled
        normalized.timing.secondaryCycles,                  // secondary_cycles
        normalized.timing.strCycles.m30,                    // str_cycles_m30
        normalized.timing.strCycles.h1,                     // str_cycles_h1
        normalized.timing.strCycles.h3,                     // str_cycles_h3
        normalized.params.values.epsilon ?? null,           // epsilon override
      ]
    );
  } catch {
    // best-effort; ignore DB failures for cookie writes
  }

  return { settings: normalized, cookie };
}

export async function setAll(nextValue: unknown): Promise<AppSettings> {
  const jar = await cookies();
  const { settings, cookie } = await serializeSettingsCookie(nextValue);
  jar.set(cookie.name, cookie.value, cookie.options);

  const mutable = jar as unknown as { delete?: (name: string) => void };
  if (mutable.delete) {
    for (const legacy of LEGACY_COOKIE_KEYS) {
      if (legacy !== cookie.name) mutable.delete(legacy);
    }
  }
  return settings;
}

export async function resolveCoinsFromSettings(): Promise<string[]> {
  // ensure user context is attached so DB view returns per-user rows
  await getCurrentSession();
  const dbCoins = await fetchCoinUniverseBases({ onlyEnabled: true });
  if (dbCoins.length) return dbCoins;
  return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
}

/** Legacy alias kept for older imports. */
export async function getSettingsServer() {
  return getAll();
}
