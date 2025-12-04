// src/core/db/client.ts
// Legacy compatibility shim for scripts that used the old db/client module.

import type { PoolClient } from "pg";
import { getPool as ensurePool, withClient } from "./pool_server";
import { sql } from "./session";

export const getPool = ensurePool;
export { sql };

export async function withConn<T>(fn: (client: PoolClient) => Promise<T>) {
  return withClient(fn);
}
