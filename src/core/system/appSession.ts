// src/core/system/appSession.ts
// Stable APP_SESSION_ID helper, generated once per process and reused everywhere.

import { randomUUID } from "crypto";
import { withClient } from "@/core/db/pool_server";

let cached: string | null = null;

/**
 * Returns a stable APP_SESSION_ID for this process.
 * - If APP_SESSION_LOCK=true/1, reuse APP_SESSION_ID/NEXT_PUBLIC_APP_SESSION_ID.
 * - Otherwise always generate a fresh per-boot id and set env accordingly.
 */
export function getAppSessionId(): string {
  if (cached) return cached;

  const lockEnv = String(process.env.APP_SESSION_LOCK ?? "").toLowerCase();
  const envLocked =
    lockEnv === "1" || lockEnv === "true" || lockEnv === "yes" || lockEnv === "lock";

  if (envLocked) {
    const fromEnv = String(
      process.env.APP_SESSION_ID ?? process.env.NEXT_PUBLIC_APP_SESSION_ID ?? ""
    )
      .trim()
      .slice(0, 64);
    if (fromEnv) {
      cached = fromEnv;
      process.env.APP_SESSION_ID = cached;
      return cached;
    }
  }

  const ts = Math.floor(Date.now() / 1000);
  cached = `session-${ts}-${randomUUID()}`;
  process.env.APP_SESSION_ID = cached;
  return cached;
}

let registered = false;

/**
 * Best-effort: record the session boot in ops.session_log (if table exists).
 * Safe to call multiple times; writes at most once per process.
 */
export async function registerAppSessionBoot(): Promise<void> {
  if (registered) return;
  registered = true;
  const sid = getAppSessionId();
  try {
    await withClient(async (client) => {
      await client.query(
        `insert into ops.session_log(app_name, app_version, opened_at, host, pid, note, session_id)
         values($1,$2, now(), inet_client_addr()::text, pg_backend_pid(), 'auto-boot', $3)
         on conflict (session_id) do nothing`,
        ["cryptophi", process.env.npm_package_version ?? "dev", sid]
      );
    });
  } catch {
    // ignore missing table or other boot failures; non-critical
  }
}
