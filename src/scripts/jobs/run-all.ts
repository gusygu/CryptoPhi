// src/scripts/jobs/run-all.ts
import "dotenv/config";

console.log("jobs: starting (set RUN_JOBS=1 to enable background workers)");

if (process.env.RUN_JOBS !== "1") {
  console.log("jobs: disabled (RUN_JOBS!=1). Exiting gracefully.");
  process.exit(0);
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
