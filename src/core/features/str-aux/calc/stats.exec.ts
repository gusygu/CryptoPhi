import type { SnapshotWithRefs } from "../frame";

export type ExecBundle = {
  appSessionId: string;
  symbol: string;
  ts: number;
  note?: string;
};

export function runExecAndUpdateSession(
  appSessionId: string,
  snapshot: SnapshotWithRefs,
  _seriesBuffers: Record<string, { ts: number; price: number }[]>,
  _pct24hMap?: Record<string, number>,
): ExecBundle[] {
  // placeholder implementation so legacy imports compile;
  // replace with real IDHR + session persistence if/when needed.
  const rows: ExecBundle[] = [];
  for (const point of snapshot.snapshot.points) {
    rows.push({
      appSessionId,
      symbol: point.symbol,
      ts: snapshot.snapshot.tick.cycleTs,
      note: "exec stub",
    });
  }
  return rows;
}
