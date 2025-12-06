// src/lib/settings/server.ts
"use server";

import { cookies } from "next/headers";
import { getCurrentSession } from "@/app/(server)/auth/session";
import {
  fetchCoinUniverseBases,
  normalizeCoinList,
  recordSettingsCookieSnapshot,
  syncCoinUniverseFromBases,
} from "@/lib/settings/coin-universe";
import { DEFAULT_SETTINGS, migrateSettings, type AppSettings } from "./schema";
import { resolveCycleSeconds } from "@/core/settings/time";
import { query, getPool } from "@/core/db/pool_server";
import { getAppSessionId } from "@/core/system/appSession";

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
  const jar = await cookies();
  const raw = jar.get(COOKIE_KEY)?.value;
  const parsed = safeParseJSON(raw);
  const settings = migrateSettings(parsed ?? DEFAULT_SETTINGS);
  try {
    const cycleSeconds = await resolveCycleSeconds(getAppSessionId());
    settings.timing.autoRefreshMs = Math.max(1_000, cycleSeconds * 1_000);
  } catch {
    // keep migrated value on failure
  }
  const userCoins = normalizeCoinList(settings.coinUniverse);
  const dbCoins = await fetchCoinUniverseBases({ onlyEnabled: true });
  // Prefer user-specific coins (cookie), otherwise fall back to DB-enabled universe, then defaults.
  settings.coinUniverse = userCoins.length
    ? userCoins
    : dbCoins.length
    ? dbCoins
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
  const userId = session?.userId ?? "anon";

  const normalizedCoins = normalizeCoinList(merged.coinUniverse);
  // Only sync global coin universe for admins; regular users keep coins in their own cookie.
  if (isAdmin) {
    await syncCoinUniverseFromBases(normalizedCoins);
  }

  const normalized: AppSettings = {
    ...merged,
    coinUniverse: normalizedCoins,
  };

  const value = JSON.stringify(normalized);
  const cookie = {
    name: COOKIE_KEY,
    value,
    options: {
      httpOnly: false,
      sameSite: "lax" as const,
      path: "/",
      maxAge: ONE_YEAR,
      // host-only cookie; not scoped to a shared domain
    },
  };

  await recordSettingsCookieSnapshot(value);
  // persist timing into DB (global/app-session scoped)
  const cycleSeconds = Math.max(1, Math.round(normalized.timing.autoRefreshMs / 1000));
  const sessionKey = getAppSessionId() ?? "global";
  try {
    if (sessionKey === "global") {
      await query(`select settings.sp_upsert_personal_time_setting($1,$2)`, [sessionKey, cycleSeconds]);
    } else {
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(`select set_config('app.current_session_id', $1, true)`, [sessionKey]);
        await c.query(`select settings.sp_upsert_personal_time_setting($1,$2)`, [sessionKey, cycleSeconds]);
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
  const dbCoins = await fetchCoinUniverseBases({ onlyEnabled: true });
  if (dbCoins.length) return dbCoins;
  return normalizeCoinList(DEFAULT_SETTINGS.coinUniverse);
}

/** Legacy alias kept for older imports. */
export async function getSettingsServer() {
  return getAll();
}
