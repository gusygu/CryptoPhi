#!/usr/bin/env ts-node

/**
 * Quick regression helper for DB context + coin universe tombstones.
 *
 * Usage:
 *   BADGE=abc123 USER_ID=<uuid> SYMBOL=PEPEUSDT pnpm ts-node src/scripts/db/context-smoke.mts
 * Optional: BADGE_ALT=otherBadge to verify badge switching.
 */

import { exit } from "node:process";
import { withDbContext } from "../../core/db/pool_server";

const userId = process.env.USER_ID ?? "";
const badge = process.env.BADGE ?? "";
const badgeAlt = process.env.BADGE_ALT ?? "";
const symbol = (process.env.SYMBOL ?? "PEPEUSDT").toUpperCase();

if (!userId || !badge) {
  console.error("Please set USER_ID and BADGE env vars.");
  exit(1);
}

async function showContext(label: string, sid: string) {
  await withDbContext({ userId, sessionId: sid, path: `[smoke] ${label}` }, async (client, meta) => {
    const { rows } = await client.query<{ user_id: string | null; session_id: string | null }>(
      `select current_setting('app.user_id', true) as user_id,
              current_setting('app.session_id', true) as session_id`,
    );
    console.log(`[ctx:${label}]`, { badge: sid, meta, db: rows[0] });
  });
}

async function toggleSymbol(enabled: boolean) {
  await withDbContext({ userId, sessionId: badge, path: "[smoke] toggle" }, async (client) => {
    await client.query(`select user_space.upsert_session_coin_universe($1,$2,$3)`, [
      badge,
      symbol,
      enabled,
    ]);
    const { rows: eff } = await client.query<{ symbol: string; enabled: boolean }>(
      `select symbol, enabled from user_space.v_effective_coin_universe where symbol = $1`,
      [symbol],
    );
    console.log(`[toggle:${enabled ? "enable" : "disable"}]`, eff[0] ?? null);
  });
}

async function main() {
  await showContext("primary", badge);
  if (badgeAlt) {
    await showContext("alt", badgeAlt);
  }
  await toggleSymbol(false);
  await toggleSymbol(true);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
