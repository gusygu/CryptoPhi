// snapshot.ts - helpers to resolve benchmark snapshots aligned to registry stamps

import { getNearestTsAtOrBefore, getSnapshotByType } from "@/core/db/db";
import type { PoolClient } from "pg";

export type SnapshotGrid = { ts: number | null; grid: (number | null)[][] };

function emptyGrid(length: number): (number | null)[][] {
  return Array.from({ length }, () => Array.from({ length }, () => null as number | null));
}

async function resolveLatestSnapshotStampMs(client?: PoolClient | null): Promise<number | null> {
  try {
    const executor = client ? client.query.bind(client) : null;
    const { rows } = await (executor
      ? executor(
          `SELECT snapshot_stamp FROM snapshot.snapshot_registry ORDER BY snapshot_stamp DESC LIMIT 1`
        )
      : (await import("@/core/db/db_server")).query(
          `SELECT snapshot_stamp FROM snapshot.snapshot_registry ORDER BY snapshot_stamp DESC LIMIT 1`
        ));
    const raw = rows[0]?.snapshot_stamp;
    if (!raw) return null;
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function rowsToGrid(
  coins: readonly string[],
  rows: { base: string; quote: string; value: number }[]
): (number | null)[][] {
  const n = coins.length;
  const grid = emptyGrid(n);
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.base.toUpperCase()}/${row.quote.toUpperCase()}`;
    map.set(key, Number(row.value));
  }
  for (let i = 0; i < n; i++) {
    const base = coins[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const quote = coins[j]!;
      const key = `${base}/${quote}`;
      grid[i][j] = map.has(key) ? map.get(key)! : null;
    }
  }
  return grid;
}

export async function fetchSnapshotBenchmarkGrid(
  coins: readonly string[],
  appSessionId?: string | null,
  client?: PoolClient | null
): Promise<SnapshotGrid> {
  const normalized = coins.map((c) => c.toUpperCase());
  const fallback = emptyGrid(normalized.length);
  const stampMs = await resolveLatestSnapshotStampMs(client);
  if (!Number.isFinite(stampMs)) {
    return { ts: null, grid: fallback };
  }

  const tsMs = await getNearestTsAtOrBefore("benchmark", stampMs!, appSessionId, client);
  if (!Number.isFinite(tsMs)) {
    return { ts: null, grid: fallback };
  }

  const rows = await getSnapshotByType("benchmark", tsMs!, normalized, appSessionId, client);
  if (!rows.length) {
    return { ts: tsMs!, grid: fallback };
  }

  return { ts: tsMs!, grid: rowsToGrid(normalized, rows as any) };
}
