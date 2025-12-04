// src/app/snapshot/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

interface SnapshotRecord {
  snapshot_id: string;
  snapshot_stamp: string;
  label: string;
  created_by_email: string | null;
  app_version: string | null;
  created_at: string;
  scope: string[];
  notes: string | null;
  client_context: Record<string, any> | null;
}

interface ApiList {
  ok: boolean;
  snapshots?: SnapshotRecord[];
  error?: string;
}

interface ApiCreate {
  ok: boolean;
  snapshot?: SnapshotRecord;
  error?: string;
}

type SnapshotPanel = {
  title: string;
  accent: string;
  description: string;
  stats: { label: string; value: string; hint?: string }[];
};

const SCOPE_FILTERS = [
  { key: "matrices", label: "Matrices" },
  { key: "str_aux", label: "Str-Aux" },
  { key: "cin_aux", label: "Cin-Aux" },
  { key: "mea_dynamics", label: "Moo" },
] as const;

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, { hour12: false });

const formatMs = (value: number | undefined | null) => {
  if (!Number.isFinite(value ?? NaN)) return "-";
  const seconds = Math.round((value as number) / 1000);
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
};

const summarizeList = (values: string[] = [], take = 3) => {
  if (!values.length) return "-";
  const sample = values.slice(0, take).join(", ");
  const extra = values.length > take ? ` +${values.length - take}` : "";
  return `${sample}${extra}`;
};

const buildPanels = (snapshot: SnapshotRecord): SnapshotPanel[] => {
  const context = (snapshot.client_context ?? {}) as Record<string, any>;
  const settings = (context.settings ?? {}) as Record<string, any>;
  const universe: string[] = Array.isArray(settings.universe)
    ? settings.universe
    : [];
  const timing = (settings.timing ?? {}) as Record<string, any>;
  const strCycles = (timing.strCycles ?? {}) as Record<string, number>;

  return [
    {
      title: "Snapshot",
      accent: "#fbbf24",
      description: `Captured ${formatDate(snapshot.snapshot_stamp)}`,
      stats: [
        { label: "Owner", value: snapshot.created_by_email ?? "system" },
        {
          label: "Scope",
          value: snapshot.scope?.length
            ? snapshot.scope.join(", ")
            : "default",
        },
        { label: "Version", value: snapshot.app_version ?? "n/a" },
      ],
    },
    {
      title: "Matrices",
      accent: "#38bdf8",
      description: `Grid anchored to ${settings.quote ?? "USDT"}`,
      stats: [
        {
          label: "Universe",
          value: `${universe.length} assets`,
          hint: summarizeList(universe),
        },
        {
          label: "Auto refresh",
          value: timing.autoRefresh ? "Enabled" : "Manual",
          hint: timing.autoRefresh
            ? `${formatMs(timing.autoRefreshMs)} loop`
            : "manual trigger",
        },
        {
          label: "Secondary loop",
          value: timing.secondaryEnabled ? "Dual" : "Primary",
          hint: `${timing.secondaryCycles ?? 0} cycles`,
        },
      ],
    },
    {
      title: "Str-Aux",
      accent: "#a855f7",
      description: "Sampler windows and gfm reference budgets",
      stats: [
        { label: "30m cycles", value: `${strCycles.m30 ?? 0}` },
        { label: "1h cycles", value: `${strCycles.h1 ?? 0}` },
        { label: "3h cycles", value: `${strCycles.h3 ?? 0}` },
      ],
    },
    {
      title: "Cin-Aux",
      accent: "#34d399",
      description: "Flow ledger + wallet anchors",
      stats: [
        {
          label: "Scope status",
          value: snapshot.scope?.includes("cin_aux") ? "Included" : "n/a",
        },
        { label: "Workspace", value: snapshot.label },
        { label: "Notes", value: snapshot.notes ?? "No annotations" },
      ],
    },
    {
      title: "Moo / MEA",
      accent: "#f472b6",
      description: "Mood tiers, engines and reference cycles",
      stats: [
        {
          label: "Scope status",
          value: snapshot.scope?.includes("mea_dynamics")
            ? "Included"
            : "n/a",
        },
        {
          label: "Universe coverage",
          value: `${universe.length ? Math.ceil(universe.length / 3) : 0} tiers`,
        },
        {
          label: "Snapshot ID",
          value: snapshot.snapshot_id.slice(0, 8),
          hint: "truncated",
        },
      ],
    },
  ];
};

const ScopeFilterChip = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-wide transition ${
      active
        ? "border-emerald-400 bg-emerald-500/10 text-emerald-200"
        : "border-white/10 text-slate-400 hover:border-white/30 hover:text-white"
    }`}
  >
    {label}
  </button>
);

const SnapshotCard = ({ snapshot }: { snapshot: SnapshotRecord }) => {
  const panels = useMemo(() => buildPanels(snapshot), [snapshot]);
  const [index, setIndex] = useState(0);
  const active = panels[index] ?? panels[0];

  const go = (delta: number) => {
    setIndex((current) => {
      const next = current + delta;
      if (next < 0) return panels.length - 1;
      if (next >= panels.length) return 0;
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-100 shadow-[0_35px_120px_-65px_rgba(8,47,73,0.85)]">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-white">{snapshot.label}</h3>
        <p className="text-xs text-slate-400">
          {formatDate(snapshot.snapshot_stamp)}
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {snapshot.scope?.map((scope) => (
            <span
              key={scope}
              className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300"
            >
              {scope}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-black/20 p-3">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
          <button
            type="button"
            onClick={() => go(-1)}
            className="rounded-full border border-white/10 px-2 py-1 hover:border-white/40"
          >
            ←
          </button>
          <span>
            Page {index + 1} / {panels.length}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            className="rounded-full border border-white/10 px-2 py-1 hover:border-white/40"
          >
            →
          </button>
        </div>
        <div className="mt-3 rounded-lg border border-white/5 bg-slate-900/60 p-3">
          <div
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: active.accent }}
          >
            {active.title}
          </div>
          <p className="mt-1 text-[13px] text-slate-300">
            {active.description}
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
            {active.stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-md border border-white/5 bg-white/5 px-3 py-2"
              >
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                  {stat.label}
                </dt>
                <dd className="text-base font-semibold text-white">
                  {stat.value}
                </dd>
                {stat.hint && (
                  <p className="text-[11px] text-slate-400">{stat.hint}</p>
                )}
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
};

export default function SnapshotAlbumPage() {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [scopeFilter, setScopeFilter] = useState<string[]>([]);

  async function loadSnapshots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/snapshot", { cache: "no-store" });
      const data: ApiList = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setSnapshots(data.snapshots ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSnapshots();
  }, []);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data: ApiCreate = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create");
      await loadSnapshots();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((snap) => {
      const scopeSet = new Set(
        (snap.scope ?? []).map((scope) => scope.toLowerCase())
      );
      const matchesScope = scopeFilter.every((scope) => scopeSet.has(scope));
      if (!matchesScope) return false;
      if (!filterText.trim()) return true;
      const haystack = [
        snap.label,
        snap.created_by_email,
        snap.app_version,
        snap.notes,
        snap.snapshot_id,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(filterText.trim().toLowerCase());
    });
  }, [snapshots, scopeFilter, filterText]);

  const toggleScope = (scope: string) => {
    setScopeFilter((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <div className="flex h-full flex-col gap-5 p-5 text-white">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_40px_120px_-60px_rgba(8,47,73,0.75)]">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Snapshots</h1>
          <p className="text-sm text-slate-300">
            Whole-system captures for matrices, cin/str aux, and moo engines.
            Filter, browse, and drill into each scope with the inline pager.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search by label, owner, version…"
              className="flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              {SCOPE_FILTERS.map((scope) => (
                <ScopeFilterChip
                  key={scope.key}
                  label={scope.label}
                  active={scopeFilter.includes(scope.key)}
                  onClick={() => toggleScope(scope.key)}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-full border border-emerald-400 bg-emerald-500/10 px-5 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {creating ? "Creating…" : "New snapshot"}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-slate-400">Loading your snapshots…</div>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filteredSnapshots.map((snapshot) => (
          <SnapshotCard key={snapshot.snapshot_id} snapshot={snapshot} />
        ))}
      </section>

      {!loading && !filteredSnapshots.length && (
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-6 text-center text-sm text-slate-400">
          No snapshots match the current filter. Capture a new one or adjust
          the filters above.
        </div>
      )}
    </div>
  );
}
