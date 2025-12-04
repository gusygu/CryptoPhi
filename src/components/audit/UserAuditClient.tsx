'use client';

import { useCallback, useEffect, useMemo, useState } from "react";

type AuditCycle = {
  cycle_seq: number;
  status: string;
  summary: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

type SamplingLog = {
  sampling_log_id?: string;
  cycle_seq: number | null;
  symbol: string;
  window_label: string;
  status: string;
  sample_ts: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

type ReportState = {
  cycleSeq: string;
  category: string;
  severity: string;
  note: string;
  submitting: boolean;
  error: string | null;
  success: string | null;
};

const initialReportState: ReportState = {
  cycleSeq: "",
  category: "issue",
  severity: "medium",
  note: "",
  submitting: false,
  error: null,
  success: null,
};

type AuditMode = "simple" | "full";

type UserAuditSummary = {
  owner_user_id: string;
  email: string;
  last_cycle_seq: number | null;
  last_cycle_created_at: string | null;
  last_cycle_status: string | null;
  total_cycles: number | null;
  total_cycles_non_ok: number | null;
  last_sampling_created_at: string | null;
  total_sampling: number | null;
  total_sampling_non_ok: number | null;
  total_reports: number | null;
  total_errors: number | null;
  total_errors_open: number | null;
};

export default function UserAuditClient() {
  const [mode, setMode] = useState<AuditMode>("simple");

  const [summary, setSummary] = useState<UserAuditSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [cycles, setCycles] = useState<AuditCycle[]>([]);
  const [sampling, setSampling] = useState<SamplingLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filterSeq, setFilterSeq] = useState("");
  const [report, setReport] = useState<ReportState>(initialReportState);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/audit/summary", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load audit summary");
      }
      const json = await res.json();
      if (!json?.ok) {
        throw new Error(json?.error ?? "Failed to load audit summary");
      }
      setSummary(json.summary ?? null);
    } catch (err: any) {
      setSummaryError(err?.message ?? "Failed to load audit summary");
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [cyclesRes, samplingRes] = await Promise.all([
        fetch("/api/audit/cycles", { cache: "no-store" }),
        fetch("/api/audit/sampling", { cache: "no-store" }),
      ]);
      if (!cyclesRes.ok) {
        throw new Error("Failed to load audit cycles");
      }
      if (!samplingRes.ok) {
        throw new Error("Failed to load sampling history");
      }
      const cyclesJson = await cyclesRes.json();
      const samplingJson = await samplingRes.json();
      if (!cyclesJson?.ok) {
        throw new Error(cyclesJson?.error ?? "Failed to load audit cycles");
      }
      if (!samplingJson?.ok) {
        throw new Error(samplingJson?.error ?? "Failed to load sampling history");
      }
      setCycles(Array.isArray(cyclesJson.items) ? cyclesJson.items : []);
      setSampling(Array.isArray(samplingJson.items) ? samplingJson.items : []);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Audit data failed to load");
      setCycles([]);
      setSampling([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load summary on mount
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // Load detailed logs when switching into full mode
  useEffect(() => {
    if (mode === "full") {
      void loadDetails();
    }
  }, [mode, loadDetails]);

  const filteredCycles = useMemo(() => {
    const query = filterSeq.trim();
    if (!query) return cycles;
    return cycles.filter((cycle) => String(cycle.cycle_seq) === query);
  }, [cycles, filterSeq]);

  const latestIssue = useMemo(
    () => cycles.find((cycle) => cycle.status === "error" || cycle.status === "warn"),
    [cycles],
  );

  const handleReportSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!report.note.trim()) {
      setReport((state) => ({ ...state, error: "Add a short description before sending." }));
      return;
    }
    setReport((state) => ({ ...state, submitting: true, error: null, success: null }));
    try {
      const cycleSeqValue = Number(report.cycleSeq);
      const payload = {
        cycleSeq: Number.isFinite(cycleSeqValue) ? cycleSeqValue : undefined,
        category: report.category,
        severity: report.severity,
        note: report.note.trim(),
      };
      const res = await fetch("/api/audit/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error("Failed to send report");
      }
      setReport((state) => ({
        ...initialReportState,
        success: "Report sent to the admins. We'll follow up soon.",
      }));
      // Refresh summary so counts of reports/errors stay in sync
      void loadSummary();
    } catch (err: any) {
      setReport((state) => ({
        ...state,
        submitting: false,
        error: err?.message ?? "Failed to send your report",
      }));
    } finally {
      setReport((state) => ({ ...state, submitting: false }));
    }
  };

  const handleRefreshClick = () => {
    void loadSummary();
    if (mode === "full") {
      void loadDetails();
    }
  };

  const totalCycles = summary?.total_cycles ?? cycles.length;
  const lastCycleSeq = summary?.last_cycle_seq ?? cycles[0]?.cycle_seq ?? "-";
  const totalIssues =
    summary?.total_cycles_non_ok ??
    cycles.filter((cycle) => cycle.status !== "ok" && cycle.status !== "idle").length;
  const latestIssueHint =
    summary?.last_cycle_seq && summary?.total_cycles_non_ok && summary.total_cycles_non_ok > 0
      ? `Latest non-ok: #${summary.last_cycle_seq}`
      : latestIssue
      ? `Latest: #${latestIssue.cycle_seq}`
      : "All clear";
  const lastCycleStatus = summary?.last_cycle_status ?? cycles[0]?.status ?? null;
  const lastCycleAt = summary?.last_cycle_created_at ?? cycles[0]?.created_at ?? null;
  const totalSamplingEvents = summary?.total_sampling ?? sampling.length;
  const samplingIssues =
    summary?.total_sampling_non_ok ?? sampling.filter((entry) => entry.status !== "ok").length;
  const lastSamplingAt =
    summary?.last_sampling_created_at ?? sampling[0]?.sample_ts ?? sampling[0]?.created_at ?? null;
  const totalReportsCount = summary?.total_reports ?? 0;
  const totalErrorsOpen = summary?.total_errors_open ?? summary?.total_errors ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Audit trail</h1>
          <p className="text-xs text-zinc-500">
            Review your engine heartbeat, cycle history, STR-aux sampling, and send mini-letters to the admin team.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-zinc-700 bg-zinc-900 text-xs">
            <button
              type="button"
              onClick={() => setMode("simple")}
              className={
                "px-3 py-1 rounded-l-md " +
                (mode === "simple"
                  ? "bg-emerald-600/30 text-emerald-100 border-r border-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-800/80")
              }
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setMode("full")}
              className={
                "px-3 py-1 rounded-r-md " +
                (mode === "full"
                  ? "bg-emerald-600/30 text-emerald-100 border-l border-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-800/80")
              }
            >
              Full
            </button>
          </div>
          <input
            value={filterSeq}
            onChange={(event) => setFilterSeq(event.target.value)}
            placeholder="Filter by cycle #"
            className="hidden sm:block rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-emerald-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleRefreshClick}
            className="rounded-md border border-emerald-500/40 px-3 py-1 text-sm text-emerald-200 hover:border-emerald-400"
            disabled={loading || summaryLoading}
          >
            {loading || summaryLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {summaryError && (
        <div className="rounded-md border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {summaryError}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-md border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {errorMsg}
        </div>
      )}

      {/* High-level metrics (used in both simple and full modes) */}
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total cycles" value={totalCycles ?? "-"} />
        <MetricCard
          label="Last cycle"
          value={lastCycleSeq}
          hint={summary?.last_cycle_status ?? cycles[0]?.status ?? null}
        />
        <MetricCard
          label="Issues spotted"
          value={totalIssues ?? 0}
          hint={latestIssueHint}
        />
      </section>

      {/* Simple mode: show a compact snapshot of sampling + flags */}
      {mode === "simple" && (
        <>
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-xs">
            <h2 className="text-sm font-semibold text-zinc-100">Engine snapshot</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Cycle timeline</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">
                  {typeof lastCycleSeq === "number" ? `#${lastCycleSeq}` : lastCycleSeq}
                </p>
                <p className="text-xs text-zinc-400">
                  {lastCycleStatus ? `Status: ${lastCycleStatus}` : "Waiting for the first cycle"}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {lastCycleAt ? `Last at ${formatDate(lastCycleAt)}` : "No cycles captured yet"}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {totalCycles ?? 0} total ú {totalIssues ?? 0} non-ok
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">STR-aux sampling</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">
                  {totalSamplingEvents ?? 0} events
                </p>
                <p className="text-xs text-zinc-400">
                  {samplingIssues ? `${samplingIssues} flagged` : "All events ok"}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {lastSamplingAt ? `Last at ${formatDate(lastSamplingAt)}` : "No sampling yet"}
                </p>
                <p className="text-[11px] text-zinc-500">
                  Drill into Full view for window-by-window notes.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Mini-letters & errors</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-100">
                  {totalReportsCount ?? 0} letters
                </p>
                <p className="text-xs text-zinc-400">
                  {totalErrorsOpen ? `${totalErrorsOpen} errors open` : "Ops queue is clear"}
                </p>
                <p className="text-[11px] text-zinc-500">
                  Fire a quick note below or send a full report in Full mode.
                </p>
                <p className="text-[11px] text-zinc-500">Admins reply via email when triaged.</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-xs">
            <h2 className="text-sm font-semibold text-zinc-100">Quick suggestion</h2>
            <p className="text-[11px] text-zinc-500">
              Drop a lightweight suggestion or comment about the app. This will be emailed to the admin team.
            </p>
            <form
              className="mt-3 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget as HTMLFormElement;
                const textarea = form.elements.namedItem("quickSuggestion") as HTMLTextAreaElement | null;
                const value = textarea?.value.trim() ?? "";
                if (!value) return;

                try {
                  await fetch("/api/audit/report", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      category: "suggestion",
                      severity: "low",
                      note: value,
                    }),
                  });
                  if (textarea) textarea.value = "";
                  void loadSummary();
                } catch {
                  // soft-fail: simple mode can fail silently
                }
              }}
            >
              <textarea
                name="quickSuggestion"
                rows={3}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-400 focus:outline-none"
                placeholder="Any suggestion or thought about the engine, UX, or metrics."
              />
              <button
                type="submit"
                className="mt-1 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-400"
              >
                Send suggestion
              </button>
            </form>
          </section>
        </>
      )}


      {/* Full mode: existing detailed sections */}
      {mode === "full" && (
        <>
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Cycle timeline</h2>
              {loading && <span className="text-xs text-zinc-500">Loading…</span>}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {filteredCycles.length === 0 && !loading && (
                <p className="text-xs text-zinc-500">No cycles logged yet.</p>
              )}
              {filteredCycles.slice(0, 40).map((cycle) => (
                <div
                  key={`${cycle.cycle_seq}-${cycle.created_at}`}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2"
                >
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="font-mono text-sm text-zinc-200">#{cycle.cycle_seq}</span>
                    <span>{formatDate(cycle.created_at)}</span>
                  </div>
                  <div className="mt-1 text-sm text-zinc-100">{cycle.summary || "—"}</div>
                  <span
                    className={`mt-1 inline-flex rounded px-2 py-[2px] text-[10px] font-semibold ${statusBadge(
                      cycle.status,
                    )}`}
                  >
                    {cycle.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">STR-aux sampling log</h2>
              <span className="text-xs text-zinc-500">Latest {sampling.slice(0, 12).length} events</span>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-900">
              <table className="min-w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Cycle</th>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Window</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">At</th>
                  </tr>
                </thead>
                <tbody>
                  {sampling.slice(0, 12).map((entry) => (
                    <tr key={`${entry.symbol}-${entry.created_at}`} className="border-t border-zinc-900/60">
                      <td className="px-3 py-2 font-mono text-sm text-zinc-200">
                        {entry.cycle_seq ?? "—"}
                      </td>
                      <td className="px-3 py-2">{entry.symbol}</td>
                      <td className="px-3 py-2">{entry.window_label}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-[2px] text-[10px] font-semibold ${statusBadge(
                            entry.status,
                          )}`}
                        >
                          {entry.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-400">{entry.message || "—"}</td>
                      <td className="px-3 py-2 text-zinc-400">
                        {formatDate(entry.sample_ts ?? entry.created_at)}
                      </td>
                    </tr>
                  ))}
                  {sampling.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-center text-zinc-500" colSpan={6}>
                        Sampling log is empty for now.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 className="text-sm font-semibold text-zinc-100">Notify admin (mini-letter)</h2>
            <p className="text-xs text-zinc-500">
              Share a quick note when you spot something unusual. Cycle # helps the team trace the issue faster.
            </p>
            <form onSubmit={handleReportSubmit} className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-3">
                <label className="flex-1 min-w-[160px] text-xs text-zinc-400">
                  Cycle #
                  <input
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                    type="text"
                    value={report.cycleSeq}
                    onChange={(event) =>
                      setReport((state) => ({ ...state, cycleSeq: event.target.value, error: null }))
                    }
                    placeholder="optional"
                  />
                </label>
                <label className="flex-1 min-w-[160px] text-xs text-zinc-400">
                  Category
                  <select
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                    value={report.category}
                    onChange={(event) =>
                      setReport((state) => ({ ...state, category: event.target.value, error: null }))
                    }
                  >
                    <option value="issue">Issue</option>
                    <option value="sampling">Sampling</option>
                    <option value="suggestion">Suggestion</option>
                  </select>
                </label>
                <label className="flex-1 min-w-[160px] text-xs text-zinc-400">
                  Severity
                  <select
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                    value={report.severity}
                    onChange={(event) =>
                      setReport((state) => ({ ...state, severity: event.target.value, error: null }))
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs text-zinc-400">
                Message
                <textarea
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
                  rows={4}
                  value={report.note}
                  onChange={(event) =>
                    setReport((state) => ({ ...state, note: event.target.value, error: null }))
                  }
                  placeholder="Tell us what you noticed…"
                />
              </label>
              {report.error && <p className="text-xs text-rose-400">{report.error}</p>}
              {report.success && <p className="text-xs text-emerald-300">{report.success}</p>}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={report.submitting}
                  className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 hover:border-emerald-400 disabled:opacity-60"
                >
                  {report.submitting ? "Sending…" : "Send report"}
                </button>
                <button
                  type="button"
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  onClick={() => setReport(initialReportState)}
                >
                  Clear form
                </button>
              </div>
            </form>
          </section>
          
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: number | string; hint?: string | null }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function statusBadge(status: string) {
  if (status === "error") return "bg-rose-900/40 text-rose-200 border border-rose-700/60";
  if (status === "warn") return "bg-amber-900/30 text-amber-200 border border-amber-600/40";
  if (status === "idle") return "bg-zinc-800 text-zinc-200 border border-zinc-700/60";
  return "bg-emerald-900/30 text-emerald-200 border border-emerald-600/40";
}

function formatDate(input?: string | null) {
  if (!input) return "—";
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}
