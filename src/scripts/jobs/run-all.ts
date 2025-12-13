// src/scripts/jobs/run-all.ts
import "dotenv/config";

const runFlag = process.env.RUN_JOBS ?? process.env.RUN_JON;
const runEnabled =
  runFlag === "1" || (typeof runFlag === "string" && runFlag.toLowerCase() === "true");

console.log("jobs: starting (set RUN_JOBS=1 or RUN_JON=1 to enable background workers)");

if (!runEnabled) {
  console.log("jobs: disabled (RUN_JOBS/RUN_JON!=1). Exiting gracefully.");
  process.exit(0);
}

const runtimeSessionId = Number(
  process.env.CIN_RUNTIME_SESSION_ID ?? process.env.CIN_WATCH_SESSION_ID ?? "",
);
if (Number.isFinite(runtimeSessionId) && runtimeSessionId > 0) {
  console.log(`jobs: runtime session id detected: ${runtimeSessionId}`);
} else {
  console.log("jobs: no runtime session id provided (set CIN_RUNTIME_SESSION_ID to wire watchers).");
}

// --- enable workers below when you're ready ---
// Example: discover + ingest klines from settings.coin_universe

import { getPool } from "@/core/db/db";
const pool = getPool();

async function getEnabledSymbols(): Promise<string[]> {
  const { rows } = await pool.query(`
    SELECT symbol::text
    FROM settings.coin_universe
    WHERE COALESCE(enabled,true)=true
    ORDER BY 1
  `);
  return rows.map(r => r.symbol);
}

// placeholder loop (no-op). Wire your real jobs here.
(async () => {
  const syms = await getEnabledSymbols();
  console.log("jobs: universe size =", syms.length);
  // TODO: start your real workers (streams/pollers/etc.)
  // keep process alive:
  setInterval(() => {}, 1 << 30);
})();
