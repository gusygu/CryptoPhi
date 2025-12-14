// src/lib/db.server.ts
// Shared entrypoint for server-only code that still imports from "@/lib/db.server".
// Re-export the canonical pool/helpers from the core layer so every caller shares
// the same connection management.

import type { PoolClient } from "pg";
import { db, getPool, query, withClient, withDbContext } from "@/core/db/pool_server";

export { db, getPool, query, withClient, withDbContext };

/** Alias kept for compatibility with older code that expected a Pool instance. */
export const pool = getPool();

/** Convenience transaction wrapper retained for docs/scripts compatibility. */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });
}
