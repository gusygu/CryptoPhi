"use strict";

import "dotenv/config";
import { query } from "@/core/db/db";

const WINDOWS: Array<[string, number, string]> = [
  ["15m", 15, "minute"],
  ["30m", 30, "minute"],
  ["1h", 1, "hour"],
];

const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "ADAUSDT",
];

async function seedWindows() {
  for (const [label, amount, unit] of WINDOWS) {
    await query("select settings.sp_upsert_window($1,$2,$3)", [label, amount, unit]);
  }
}

async function seedCoinUniverse(symbols: string[]) {
  const distinct = Array.from(new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)));
  if (!distinct.length) return;
  await query("select settings.sp_sync_coin_universe($1::text[], true)", [distinct]);
}

async function seedPersonalTime() {
  await query("select settings.sp_upsert_personal_time_setting($1,$2)", ["global", 80]);
}

async function main() {
  console.log("Seeding bootstrap data...");
  await seedWindows();
  await seedCoinUniverse(DEFAULT_SYMBOLS);
  await seedPersonalTime();
  console.log("Bootstrap seed complete.");
}

main().catch((err) => {
  console.error("Bootstrap seed failed:", err);
  process.exit(1);
});
