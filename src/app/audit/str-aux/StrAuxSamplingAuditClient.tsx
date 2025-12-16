'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type SamplingWindowKey = "30m" | "1h" | "3h";

type SamplingAudit = {
  ok: boolean;
  window: SamplingWindowKey;
  summary: {
    firstSampleTs: string | null;
    lastSampleTs: string | null;
    lastWindowUpdateTs: string | null;
    expectedSamples: number;
    actualSamples: number;
    coveragePct: number;
    lagMs: number | null;
  };
  ledger: Array<{
    symbol: string | null;
    sampleTs: string | null;
    lastTickTs: string | null;
    producedRows: number | null;
    driftMs: number | null;
    jitterMs: number | null;
    status: string;
    lastError: string | null;
    cycleId: string | null;
    markerId: string | null;
    bytesProcessed: number | null;
    rowsProcessed: number | null;
    updatedAt: string | null;
  }>;
  marker: {
    markerId: string | null;
    cycleId: string | null;
    startTs: string | null;
    lastUpdateTs: string | null;
    symbols: string[];
    rowsProcessed: number | null;
    bytesProcessed: number | null;
  };
};

const WINDOWS: SamplingWindowKey[] = ["30m", "1h", "3h"];

export default function StrAuxSamplingAuditClient() {
  const params = useParams<{ badge?: string | string[] }>();
  const badge = useMemo(() => {
    const raw = params?.badge;
    if (!raw) return null;
    return Array.isArray(raw) ? String(raw[0] ?? "").trim() : String(raw).trim();
  }, [params]);

  const [windowKey, setWindowKey] = useState<SamplingWindowKey>("30m");
  const [data, setData] = useState<SamplingAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = badge ? `/api/${badge}/audit/str-aux/sampling-audit` : `/api/audit/str-aux/sampling-audit`;

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}?window=${windowKey}`, { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as SamplingAudit;
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load audit");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, windowKey]);

  useEffect(() => {
    void fetchAudit();
  }, [fetchAudit]);

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">Str-aux sampling</p>
          <h1 className="text-2xl font-semibold text-zinc-50">Window health & ledger</h1>
          <p className="text-xs text-zinc-400">Coverage, lag, and the last few sampling points for the selected window.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
          <span className="text-emerald-200/80">Window</span>
          <select
            className="rounded-md border border-emerald-500/40 bg-transparent px-2 py-1 text-emerald-100 focus:outline-none"
            value={windowKey}
            onChange={(e) => setWindowKey(e.target.value as SamplingWindowKey)}
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w} className="bg-zinc-900 text-emerald-100">
                {w}
              </option>
            ))}
          </select>
          <button
            onClick={() => fetchAudit()}
            disabled={loading}
            className="rounded-md border border-emerald-500/40 px-3 py-1 text-emerald-100 transition hover:bg-emerald-500/10 disabled:opacity-40"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div>}

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="First sample" value={summary?.firstSampleTs ? formatTs(summary.firstSampleTs) : "—"} />
        <MetricCard label="Last sample" value={summary?.lastSampleTs ? formatTs(summary.lastSampleTs) : "—"} />
        <MetricCard label="Last window update" value={summary?.lastWindowUpdateTs ? formatTs(summary.lastWindowUpdateTs) : "—"} />
        <MetricCard label="Expected samples" value={summary?.expectedSamples ?? 0} />
        <MetricCard label="Actual samples" value={summary?.actualSamples ?? 0} />
        <MetricCard
          label="Coverage"
          value={
            summary
              ? `${summary.coveragePct.toFixed(1)}%`
              : "—"
          }
          accent={coverageTone(summary?.coveragePct)}
        />
        <MetricCard
          label="Lag"
          value={summary?.lagMs != null ? `${Math.round(summary.lagMs / 1000)}s` : "—"}
          accent={summary?.lagMs != null && summary.lagMs > 90_000 ? "warn" : "muted"}
        />
      </section>

      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Sample point ledger</p>
            <p className="text-xs text-zinc-400">Last 8 ticks for this window with drift/jitter hints.</p>
          </div>
          <span className="rounded-full border border-zinc-700/70 px-2 py-0.5 text-[11px] uppercase text-zinc-300">
            {data?.ledger.length ?? 0} rows
          </span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-zinc-200">
            <thead className="border-b border-zinc-800/80 text-[11px] uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="py-2 pr-2 text-left">Symbol</th>
                <th className="py-2 pr-2 text-left">Sample ts</th>
                <th className="py-2 pr-2 text-left">Last tick</th>
                <th className="py-2 pr-2 text-right">Rows</th>
                <th className="py-2 pr-2 text-right">Drift</th>
                <th className="py-2 pr-2 text-right">Jitter</th>
                <th className="py-2 pr-2 text-left">Status</th>
                <th className="py-2 pr-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {(data?.ledger ?? []).map((row, idx) => (
                <tr key={`${row.symbol}-${row.sampleTs}-${idx}`} className="border-b border-zinc-900/60 last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-[11px] text-emerald-100">{row.symbol ?? "—"}</td>
                  <td className="py-2 pr-2">{row.sampleTs ? formatTs(row.sampleTs) : "—"}</td>
                  <td className="py-2 pr-2">{row.lastTickTs ? formatTs(row.lastTickTs) : "—"}</td>
                  <td className="py-2 pr-2 text-right">{row.producedRows ?? "—"}</td>
                  <td className="py-2 pr-2 text-right">{row.driftMs != null ? `${Math.round(row.driftMs)} ms` : "—"}</td>
                  <td className="py-2 pr-2 text-right">{row.jitterMs != null ? `${Math.round(row.jitterMs)} ms` : "—"}</td>
                  <td className="py-2 pr-2">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="py-2 pr-2 text-amber-300/80">{row.lastError ?? "—"}</td>
                </tr>
              ))}
              {!loading && (data?.ledger ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-zinc-500">
                    No sampling rows yet.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-zinc-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-[1.4fr_minmax(0,1fr)]">
        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <p className="text-[11px] uppercase tracking-wide text-indigo-200/80">Current marker</p>
          <div className="mt-2 grid gap-2 text-sm text-indigo-50 md:grid-cols-2">
            <Field label="Marker id" value={data?.marker.markerId ?? "—"} />
            <Field label="Cycle id" value={data?.marker.cycleId ?? "—"} />
            <Field label="Start" value={data?.marker.startTs ? formatTs(data.marker.startTs) : "—"} />
            <Field label="Last update" value={data?.marker.lastUpdateTs ? formatTs(data.marker.lastUpdateTs) : "—"} />
            <Field label="Symbols" value={data?.marker.symbols?.join(", ") || "—"} />
            <Field
              label="Rows / bytes"
              value={
                data
                  ? `${data.marker.rowsProcessed ?? "—"} rows · ${data.marker.bytesProcessed ?? "—"} bytes`
                  : "—"
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-4 text-xs text-zinc-400">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Hints</p>
          <ul className="mt-2 space-y-1">
            <li>- Coverage compares actual sample rows vs expected 5s cadence for the window.</li>
            <li>- Lag reflects age of the latest sample.</li>
            <li>- Status turns STALE when drift exceeds the window cadence.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, accent = "muted" }: { label: string; value: string | number; accent?: "muted" | "warn" | "ok" }) {
  const tone =
    accent === "warn"
      ? "text-amber-200"
      : accent === "ok"
        ? "text-emerald-200"
        : "text-zinc-100";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status?.toUpperCase?.() ?? "UNKNOWN";
  const color =
    s === "OK"
      ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100"
      : s === "STALE" || s === "WARN"
        ? "border-amber-400/50 bg-amber-500/10 text-amber-100"
        : s === "GAP"
          ? "border-sky-400/50 bg-sky-500/10 text-sky-100"
          : "border-rose-400/50 bg-rose-500/10 text-rose-100";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${color}`}>
      {s}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-indigo-200/70">{label}</span>
      <span className="text-sm text-indigo-50">{value}</span>
    </div>
  );
}

function formatTs(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function coverageTone(pct?: number) {
  if (pct == null || Number.isNaN(pct)) return "muted";
  if (pct >= 90) return "ok";
  if (pct >= 60) return "muted";
  return "warn";
}
