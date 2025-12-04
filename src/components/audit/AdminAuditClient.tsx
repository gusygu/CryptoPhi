'use client';

import { useCallback, useEffect, useState } from "react";

type AdminActivity = {
  audit_id: string;
  user_id: string;
  event: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type AdminError = {
  error_id: string;
  owner_user_id: string | null;
  cycle_seq: number | null;
  summary: string;
  details: Record<string, unknown> | null;
  status: string;
  created_at: string;
};

type AdminReport = {
  report_id: string;
  owner_user_id: string;
  cycle_seq: number | null;
  category: string;
  severity: string;
  note: string | null;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
};

type VitalsLog = {
  vitals_id: string;
  snapshot_ts: string;
  payload: Record<string, unknown>;
};

type AuditMode = "simple" | "full";

type SystemSummary = {
  total_cycles: number;
  total_cycles_non_ok: number;
  last_cycle_created_at: string | null;
  total_sampling: number;
  total_sampling_non_ok: number;
  last_sampling_created_at: string | null;
  total_reports: number;
  total_errors: number;
  total_errors_open: number;
  last_error_created_at: string | null;
  last_vitals_ts: string | null;
  last_vitals_payload: Record<string, unknown> | null;
};

type NoisyUser = {
  owner_user_id: string;
  email: string;
  total_cycles_non_ok: number;
  total_sampling_non_ok: number;
  total_errors_open: number;
};

export default function AdminAuditClient() {
  const [mode, setMode] = useState<AuditMode>("simple");

  const [activities, setActivities] = useState<AdminActivity[]>([]);
  const [errors, setErrors] = useState<AdminError[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [vitals, setVitals] = useState<VitalsLog[]>([]);

  const [systemSummary, setSystemSummary] = useState<SystemSummary | null>(null);
  const [noisyUsers, setNoisyUsers] = useState<NoisyUser[]>([]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [
        activityRes,
        errorsRes,
        reportsRes,
        vitalsRes,
        systemRes,
      ] = await Promise.all([
        fetch("/api/admin/audit/activity", { cache: "no-store" }),
        fetch("/api/admin/audit/errors", { cache: "no-store" }),
        fetch("/api/admin/audit/reports", { cache: "no-store" }),
        fetch("/api/admin/audit/vitals", { cache: "no-store" }),
        fetch("/api/audit/system", { cache: "no-store" }),
      ]);

      if (!activityRes.ok || !errorsRes.ok || !reportsRes.ok || !vitalsRes.ok || !systemRes.ok) {
        throw new Error("Failed to load admin audit data");
      }

      const [
        activityJson,
        errorsJson,
        reportsJson,
        vitalsJson,
        systemJson,
      ] = await Promise.all([
        activityRes.json(),
        errorsRes.json(),
        reportsRes.json(),
        vitalsRes.json(),
        systemRes.json(),
      ]);

      if (!activityJson?.ok || !errorsJson?.ok || !reportsJson?.ok || !vitalsJson?.ok || !systemJson?.ok) {
        throw new Error("Audit endpoints returned an error");
      }

      setActivities(Array.isArray(activityJson.items) ? activityJson.items : []);
      setErrors(Array.isArray(errorsJson.items) ? errorsJson.items : []);
      setReports(Array.isArray(reportsJson.items) ? reportsJson.items : []);
      setVitals(Array.isArray(vitalsJson.items) ? vitalsJson.items : []);

      setSystemSummary(systemJson.summary ?? null);
      setNoisyUsers(Array.isArray(systemJson.noisyUsers) ? systemJson.noisyUsers : []);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Failed to load admin audit data");
      setActivities([]);
      setErrors([]);
      setReports([]);
      setVitals([]);
      setSystemSummary(null);
      setNoisyUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totalOpenErrors =
    systemSummary?.total_errors_open ?? errors.length;
  const totalReports =
    systemSummary?.total_reports ?? reports.length;
  const totalVitals =
    vitals.length;

  const lastVitalsTs = systemSummary?.last_vitals_ts ?? vitals[0]?.snapshot_ts ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Admin audit dashboard</h1>
          <p className="text-xs text-zinc-500">
            Track system vitals, error queue, user activity, and the mini-letters sent by the community.
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
          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-md border border-emerald-500/40 px-3 py-1 text-sm text-emerald-200 hover:border-emerald-400 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="rounded-md border border-rose-600/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
          {errorMsg}
        </div>
      )}

      {/* Top metrics – used in both simple and full modes */}
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Open error queue"
          value={totalOpenErrors}
        />
        <MetricCard
          label="Mini-letters"
          value={totalReports}
        />
        <MetricCard
          label="Vitals snapshots"
          value={totalVitals}
          hint={
            lastVitalsTs
              ? `Last: ${formatDate(lastVitalsTs)}`
              : undefined
          }
        />
      </section>

      {/* Simple mode: condensed system snapshot + noisy users */}
      {mode === "simple" && (
        <>
          <SectionCard title="System snapshot">
            {systemSummary ? (
              <div className="grid gap-3 md:grid-cols-3 text-xs">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                    Cycles
                  </p>
                  <p className="mt-1 text-sm text-zinc-100">
                    {systemSummary.total_cycles} total
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Non-ok: {systemSummary.total_cycles_non_ok}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Last:{" "}
                    {systemSummary.last_cycle_created_at
                      ? formatDate(systemSummary.last_cycle_created_at)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                    STR-aux sampling
                  </p>
                  <p className="mt-1 text-sm text-zinc-100">
                    {systemSummary.total_sampling} events
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Non-ok: {systemSummary.total_sampling_non_ok}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Last:{" "}
                    {systemSummary.last_sampling_created_at
                      ? formatDate(systemSummary.last_sampling_created_at)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                    Error queue & vitals
                  </p>
                  <p className="mt-1 text-sm text-zinc-100">
                    Errors: {systemSummary.total_errors} total
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Open: {systemSummary.total_errors_open}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Last error:{" "}
                    {systemSummary.last_error_created_at
                      ? formatDate(systemSummary.last_error_created_at)
                      : "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Vitals snapshot:{" "}
                    {systemSummary.last_vitals_ts
                      ? formatDate(systemSummary.last_vitals_ts)
                      : "—"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                No system summary available yet.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Noisy users (top 20)">
            {noisyUsers.length === 0 && (
              <p className="text-xs text-zinc-500">
                No users with open errors or non-ok cycles yet.
              </p>
            )}
            {noisyUsers.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-zinc-900">
                <table className="min-w-full text-left text-xs text-zinc-300">
                  <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Non-ok cycles</th>
                      <th className="px-3 py-2">Non-ok sampling</th>
                      <th className="px-3 py-2">Open errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noisyUsers.map((u) => (
                      <tr key={u.owner_user_id} className="border-t border-zinc-900/70">
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {u.owner_user_id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-2">{u.email}</td>
                        <td className="px-3 py-2">{u.total_cycles_non_ok}</td>
                        <td className="px-3 py-2">{u.total_sampling_non_ok}</td>
                        <td className="px-3 py-2">{u.total_errors_open}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Full mode: existing deep-dive admin audit layout */}
      {mode === "full" && (
        <>
          <SectionCard title="System vitals snapshots">
            <div className="space-y-3 text-xs">
              {vitals.slice(0, 5).map((entry) => (
                <div
                  key={entry.vitals_id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>#{entry.vitals_id.slice(0, 8)}</span>
                    <span>{formatDate(entry.snapshot_ts)}</span>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-200">
                    {JSON.stringify(entry.payload ?? {}, null, 2)}
                  </pre>
                </div>
              ))}
              {vitals.length === 0 && (
                <p className="text-zinc-500">No vitals snapshots yet.</p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Error queue">
            <div className="overflow-x-auto rounded-lg border border-zinc-900">
              <table className="min-w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Cycle</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.slice(0, 12).map((entry) => (
                    <tr key={entry.error_id} className="border-t border-zinc-900/70">
                      <td className="px-3 py-2 font-mono">
                        {entry.error_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">
                        {entry.owner_user_id ?? "n/a"}
                      </td>
                      <td className="px-3 py-2">
                        {entry.cycle_seq ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-200">
                        {entry.summary}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-[2px] text-[10px] font-semibold ${statusBadge(
                            entry.status,
                          )}`}
                        >
                          {entry.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-400">
                        {formatDate(entry.created_at)}
                      </td>
                    </tr>
                  ))}
                  {errors.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-zinc-500"
                        colSpan={6}
                      >
                        No errors queued.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Mini-letters from users">
            <div className="space-y-3 text-sm">
              {reports.slice(0, 10).map((entry) => (
                <div
                  key={entry.report_id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span className="font-mono text-zinc-300">
                      {entry.owner_user_id.slice(0, 8)}
                    </span>
                    <span>{formatDate(entry.created_at)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    #{entry.cycle_seq ?? "n/a"} · {entry.category} ·{" "}
                    {entry.severity}
                  </div>
                  <p className="mt-1 text-sm text-zinc-100">
                    {entry.note || "—"}
                  </p>
                  {entry.acknowledged_at && (
                    <p className="text-[11px] text-emerald-300">
                      Acknowledged at {formatDate(entry.acknowledged_at)}
                    </p>
                  )}
                </div>
              ))}
              {reports.length === 0 && (
                <p className="text-xs text-zinc-500">
                  No pending mini-letters.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Recent admin activity">
            <div className="overflow-x-auto rounded-lg border border-zinc-900">
              <table className="min-w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/70 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Details</th>
                    <th className="px-3 py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.slice(0, 10).map((entry) => (
                    <tr
                      key={entry.audit_id}
                      className="border-t border-zinc-900/70"
                    >
                      <td className="px-3 py-2 text-zinc-100">
                        {entry.event}
                      </td>
                      <td className="px-3 py-2">{entry.user_id}</td>
                      <td className="px-3 py-2 text-zinc-400">
                        {entry.details
                          ? JSON.stringify(entry.details)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-zinc-400">
                        {formatDate(entry.created_at)}
                      </td>
                    </tr>
                  ))}
                  {activities.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-zinc-500"
                        colSpan={4}
                      >
                        No admin activity captured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function statusBadge(status: string) {
  if (status === "error" || status === "open") {
    return "bg-rose-900/40 text-rose-200 border border-rose-700/60";
  }
  if (status === "warn") return "bg-amber-900/30 text-amber-200 border border-amber-600/40";
  if (status === "resolved") return "bg-emerald-900/30 text-emerald-200 border border-emerald-600/50";
  return "bg-zinc-900 text-zinc-300 border border-zinc-800";
}

function formatDate(input?: string | null) {
  if (!input) return "—";
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}
