"use client";

import React, { useEffect, useMemo, useState } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent, safeJsonFetch } from "@/components/features/dynamics/utils";
import type { CinStat, DynamicsSnapshot } from "@/core/converters/provider.types";

type AuxMetrics = DynamicsSnapshot["metrics"];

export type AuxiliaryCardProps = {
  badge: string;
  base: string;
  quote: string;
  metrics?: AuxMetrics | null;
  cin?: Record<string, CinStat> | null;
  candidates?: string[];
  coins?: string[];
  benchmarkGrid?: number[][] | undefined;
  lastUpdated?: number | string | Date | null;
  loading?: boolean;
  className?: string;
  previewSymbols?: Set<string>;
};

type StatBadgeProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
};

type StrMetricItemProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
};

type CinRow = { symbol: string; stat: CinStat };
type StrAuxSnapshot = {
  gfmDeltaPct: number | null;
  bfmDeltaPct: number | null;
  shifts: number | null;
  swaps: number | null;
  inertia: number | null;
  disruption: number | null;
  vTendency: number | null;
  vSwap: number | null;
};

type StrAuxState = {
  loading: boolean;
  error: string | null;
  metrics: StrAuxSnapshot | null;
};
type CinState = {
  loading: boolean;
  error: string | null;
  cin: Record<string, CinStat> | null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

function toMillis(value: AuxiliaryCardProps["lastUpdated"]): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatRelative(value: AuxiliaryCardProps["lastUpdated"]) {
  const millis = toMillis(value);
  if (millis == null) return "n/a";
  const delta = Math.max(0, Date.now() - millis);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function StatBadge({ label, value, hint }: StatBadgeProps) {
  return (
    <div className="rounded-[16px] border border-emerald-400/25 bg-[#03121c]/80 px-3 py-2.5 text-right text-sm text-emerald-50/80 shadow-[0_12px_24px_rgba(0,0,0,0.4)]">
      <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-100/70">{label}</div>
      <div className="mt-1 font-mono text-lg leading-tight text-emerald-50">{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-emerald-200/70">{hint}</div> : null}
    </div>
  );
}

function StrMetricItem({ label, value, hint }: StrMetricItemProps) {
  return (
    <div className="rounded-[14px] border border-emerald-400/20 bg-[#020a12]/80 px-3 py-2.5 text-right shadow-[0_10px_22px_rgba(0,0,0,0.4)]">
      <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-100/70">{label}</div>
      <div className="mt-1 font-mono text-[14px] leading-tight text-emerald-50">{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-emerald-200/70">{hint}</div> : null}
    </div>
  );
}

const createEmptyCinStat = (): CinStat => ({
  session: { imprint: 0, luggage: 0 },
  cycle: { imprint: 0, luggage: 0 },
});

function deriveCinRows(
  cin: Record<string, CinStat> | null | undefined,
  base: string,
  quote: string
): CinRow[] {
  if (!cin) return [];
  const wanted = Array.from(
    new Set(
      [base, quote]
        .map((token) => String(token ?? "").toUpperCase())
        .filter(Boolean)
    )
  );
  if (!wanted.length) return [];

  const map = new Map<string, CinStat>();
  for (const [symbol, stat] of Object.entries(cin)) {
    const key = String(symbol ?? "").toUpperCase();
    if (!key) continue;
    map.set(key, stat);
  }

  const rows: CinRow[] = [];
  for (const symbol of wanted) {
    rows.push({ symbol, stat: map.get(symbol) ?? createEmptyCinStat() });
  }
  return rows;
}

function matrixValue(
  coins: string[] | undefined,
  grid: number[][] | undefined,
  base: string,
  quote: string
): number | null {
  if (!coins?.length || !grid?.length) return null;
  const i = coins.indexOf(base);
  const j = coins.indexOf(quote);
  if (i < 0 || j < 0) return null;
  const value = grid[i]?.[j];
  return Number.isFinite(value) ? (value as number) : null;
}

export default function AuxiliaryCard({
  badge,
  base,
  quote,
  metrics,
  cin,
  candidates,
  coins,
  benchmarkGrid,
  lastUpdated,
  loading,
  className,
  previewSymbols,
}: AuxiliaryCardProps) {
  const A = useMemo(() => String(base ?? "").toUpperCase(), [base]);
  const B = useMemo(() => String(quote ?? "").toUpperCase(), [quote]);
  const symbol = useMemo(() => (A && B ? `${A}${B}` : ""), [A, B]);

  const [strState, setStrState] = useState<StrAuxState>({ loading: false, error: null, metrics: null });
  const [cinState, setCinState] = useState<CinState>({ loading: false, error: null, cin: null });

  const mooMetric = (metrics as any)?.moo ?? metrics?.mea ?? null;
  const strMetric = metrics?.str ?? null;
  const cinStats = cin ?? metrics?.cin ?? null;
  const snapshotStrMetrics = useMemo<StrAuxSnapshot | null>(() => {
    if (!strMetric) return null;
    return {
      gfmDeltaPct: toNumber((strMetric as any)?.gfmDeltaPct),
      bfmDeltaPct: toNumber((strMetric as any)?.bfmDeltaPct),
      shifts: toNumber((strMetric as any)?.shift),
      swaps: toNumber((strMetric as any)?.swaps ?? (strMetric as any)?.vSwap),
      inertia: toNumber((strMetric as any)?.inertia ?? (strMetric as any)?.intrinsic?.inertia?.total),
      disruption: toNumber((strMetric as any)?.disruption),
      vTendency: toNumber((strMetric as any)?.vTendency),
      vSwap: toNumber((strMetric as any)?.vSwap),
    };
  }, [strMetric]);

  const effectiveCin = useMemo(
    () => cinState.cin ?? cinStats ?? null,
    [cinState.cin, cinStats]
  );

  const candidateCount = Array.isArray(candidates)
    ? candidates.length
    : Object.keys(effectiveCin ?? {}).length;
  const universeCount = coins?.length ?? 0;
  const openingValue = useMemo(() => matrixValue(coins, benchmarkGrid, A, B), [coins, benchmarkGrid, A, B]);
  const derivedCinRows = useMemo(() => deriveCinRows(effectiveCin, A, B), [effectiveCin, A, B]);
  const cinLoading = loading || cinState.loading;

  useEffect(() => {
    if (!symbol) {
      setStrState({ loading: false, error: null, metrics: null });
      return;
    }
    if (!badge) return;
    if (typeof window === "undefined") return;

    const controller = new AbortController();
    setStrState((prev) => ({
      ...prev,
      loading: snapshotStrMetrics ? false : true,
      error: null,
      metrics: snapshotStrMetrics ?? prev.metrics,
    }));

    (async () => {
      try {
        const badgePrefix = encodeURIComponent(badge || "global");
        const statsUrl = new URL(`/api/${badgePrefix}/str-aux/stats`, window.location.origin);
        statsUrl.searchParams.set("symbols", symbol);
        statsUrl.searchParams.set("window", "30m");
        statsUrl.searchParams.set("bins", "128");

        const payload = await safeJsonFetch<{
          ok: boolean;
          out?: Record<string, any>;
          error?: string;
        }>(statsUrl.toString(), {
          cache: "no-store",
          signal: controller.signal,
          credentials: "include",
          headers: { "x-app-session": badge },
        });
        if (!payload?.ok) throw new Error(payload?.error ?? "str-aux stats error");

        const entry = payload.out?.[symbol];
        if (!entry || entry.ok === false) {
          throw new Error(entry?.error ?? "str-aux metrics unavailable");
        }

        const stats = entry.stats ?? {};
        const vectors = stats.vectors ?? {};
        const swap = stats.vSwap ?? vectors.swap ?? null;
        const metrics: StrAuxSnapshot = {
          gfmDeltaPct: toNumber(entry.metrics?.gfm?.deltaPct ?? stats.deltaGfmPct),
          bfmDeltaPct: toNumber(entry.metrics?.bfm?.deltaPct ?? stats.deltaBfmPct),
          shifts: toNumber(entry.shifts?.nShifts ?? entry.shifts?.count),
          swaps: toNumber(swap?.Q),
          inertia: toNumber(
            entry.metrics?.intrinsic?.inertia?.total ??
              stats.inertia?.total ??
              entry.fm?.inertia
          ),
          disruption: toNumber(entry.metrics?.disruption ?? entry.fm?.disruption),
          vTendency: toNumber(
            stats.tendency?.score ??
              stats.tendency?.metrics?.score ??
              vectors.tendency?.metrics?.score
          ),
          vSwap: toNumber(swap?.score),
        };

        if (!controller.signal.aborted) {
          setStrState({ loading: false, error: null, metrics });
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setStrState((prev) => ({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          metrics: snapshotStrMetrics ?? prev.metrics,
        }));
      }
    })();

    return () => controller.abort();
  }, [symbol, badge, snapshotStrMetrics]);

  useEffect(() => {
    if (!badge || !symbol) {
      setCinState((prev) => ({ ...prev, loading: false, error: null }));
      return;
    }
    if (typeof window === "undefined") return;

    const controller = new AbortController();
    setCinState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const badgePrefix = encodeURIComponent(badge || "global");
        const url = new URL(`/api/${badgePrefix}/cin-aux/snapshot`, window.location.origin);
        const coinsParam = Array.from(new Set([A, B].filter(Boolean))).join(",");
        if (coinsParam) url.searchParams.set("coins", coinsParam);

        const res = await fetch(url.toString(), {
          cache: "no-store",
          signal: controller.signal,
          headers: { "x-app-session": badge },
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          setCinState((prev) => ({ ...prev, loading: false, error: text || `cin snapshot ${res.status}` }));
          return;
        }
        const body = (await res.json()) as { ok: boolean; cin?: Record<string, CinStat>; error?: any };
        if (body?.ok && body.cin) {
          setCinState({ loading: false, error: null, cin: body.cin });
        } else {
          const msg =
            typeof body?.error === "string"
              ? body.error
              : body?.error?.message ?? body?.error?.code ?? "cin snapshot unavailable";
          setCinState((prev) => ({ ...prev, loading: false, error: msg }));
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setCinState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();

    return () => controller.abort();
  }, [badge, symbol, A, B]);

  const status =
    loading || strState.loading ? "Loading auxiliary data..." : `Snapshot - ${formatRelative(lastUpdated)}`;

  const formattedMoo = mooMetric
    ? formatNumber(mooMetric.value, { precision: 4, fallback: "-" })
    : "-";

  const formattedTier = mooMetric?.tier ? mooMetric.tier : "n/a";
  const formattedGfm = strMetric ? formatNumber(strMetric.gfm, { precision: 4, fallback: "-" }) : "-";

  const strMetricsList = useMemo(() => {
    const data = strState.metrics;
    const fallbackShift = toNumber(strMetric?.shift);
    const fallbackTendency = toNumber(strMetric?.vTendency);

    return [
      {
        label: "GFM (delta)",
        value: formatPercent(data?.gfmDeltaPct, { precision: 2, fallback: "-" }),
        hint: "Delta vs reference (%)",
      },
      {
        label: "BFM (delta)",
        value: formatPercent(data?.bfmDeltaPct, { precision: 2, fallback: "-" }),
        hint: "Normalized delta (%)",
      },
      {
        label: "Shifts",
        value: formatNumber(data?.shifts ?? fallbackShift, { precision: 0, fallback: "-" }),
        hint: "Detected regime changes",
      },
      {
        label: "Swaps",
        value: formatNumber(data?.swaps, { precision: 2, fallback: "-" }),
        hint: "Quartile displacement (Q)",
      },
      {
        label: "Inertia",
        value: formatNumber(data?.inertia, { precision: 3, fallback: "-" }),
        hint: "Momentum inertia (Sigma)",
      },
      {
        label: "Disruption",
        value: formatNumber(data?.disruption, { precision: 3, fallback: "-" }),
        hint: "Histogram disruption",
      },
      {
        label: "vTendency",
        value: formatNumber(data?.vTendency ?? fallbackTendency, { precision: 3, fallback: "-" }),
        hint: "Directional tendency score",
      },
      {
        label: "vSwap",
        value: formatNumber(data?.vSwap, { precision: 3, fallback: "-" }),
        hint: "Swap vector score",
      },
    ];
  }, [strState.metrics, strMetric]);

  return (
    <DynamicsCard
      title="Auxiliary card"
      subtitle={`${A} -> ${B}`}
      status={status}
      className={classNames(
        "rounded-[22px] border border-emerald-400/20 bg-[#02060d]/95 shadow-[0_14px_34px_rgba(0,0,0,0.45)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-4"
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.55fr)]">
        <section className="rounded-[18px] border border-emerald-400/20 bg-[#030c15]/85 p-3 shadow-[0_12px_26px_rgba(0,0,0,0.4)]">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[12px] border border-emerald-400/25 bg-emerald-400/10 px-2 py-2">
              <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/70">MOO</div>
              <div className="font-mono text-lg text-emerald-50">{formattedMoo}</div>
              <div className="font-mono text-[10px] text-emerald-200/80">Tier {formattedTier}</div>
            </div>
            <div className="rounded-[12px] border border-emerald-400/25 bg-emerald-400/10 px-2 py-2">
              <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/70">Candidates</div>
              <div className="font-mono text-lg text-emerald-50">{candidateCount}</div>
              <div className="font-mono text-[10px] text-emerald-200/80">{A}/{B}</div>
            </div>
            <div className="rounded-[12px] border border-emerald-400/25 bg-emerald-400/10 px-2 py-2">
              <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/70">Universe</div>
              <div className="font-mono text-lg text-emerald-50">{universeCount}</div>
              <div className="font-mono text-[10px] text-emerald-200/80">
                Open {openingValue != null ? formatNumber(openingValue, { precision: 4, fallback: "-" }) : "-"}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[16px] border border-emerald-400/25 bg-[#04101a]/80 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-emerald-100/80">STR-Aux metrics</div>
            {strState.error ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-[11px] text-amber-200">
                {strState.error}
              </div>
            ) : strState.loading ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={`str-skeleton-${idx}`}
                    className="h-16 rounded-xl border border-emerald-500/25 bg-emerald-500/10 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2 py-2 text-right">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-100/80">GFM</div>
                  <div className="font-mono text-[14px] text-emerald-50">{formattedGfm}</div>
                </div>
                {strMetricsList.map((item) => (
                  <div key={item.label} className="rounded-lg border border-emerald-400/20 bg-[#020a12]/80 px-2 py-2 text-right">
                    <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-100/75">{item.label}</div>
                    <div className="font-mono text-[14px] text-emerald-50">{item.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <section className="rounded-[22px] border border-emerald-400/20 bg-[#02060f]/85 p-4 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-100/70">Snapshot state</div>
            <div className="mt-1 text-sm text-emerald-50">Updated {formatRelative(lastUpdated)}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatBadge label="GFM (abs)" value={formattedGfm} hint={undefined} />
            <StatBadge
              label="Velocity"
              value={formatNumber(strMetric?.vTendency, { precision: 3, fallback: "-" })}
              hint={undefined}
            />
            <StatBadge
              label="Shift"
              value={formatNumber(strMetric?.shift, { precision: 3, fallback: "-" })}
              hint={undefined}
            />
            <StatBadge label="CIN tracked" value={derivedCinRows.length} hint={undefined} />
          </div>
        </section>
      </div>

      <div className="rounded-[22px] border border-emerald-400/25 bg-[#030c15]/85 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.35em] text-emerald-100/80">CIN-Aux</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/70">
            {`Snapshot ${formatRelative(lastUpdated)}`}
          </div>
        </div>
        {cinLoading ? (
          <div className="space-y-2 text-[11px] text-emerald-200/50">
            <div className="h-9 w-full animate-pulse rounded-lg bg-emerald-500/10" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-emerald-500/10" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-emerald-500/10" />
          </div>
        ) : cinState.error ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-[11px] text-amber-200">
            {cinState.error}
          </div>
        ) : derivedCinRows.length ? (
          <div className="space-y-2">
            {derivedCinRows.map(({ symbol, stat }) => (
              <div
                key={symbol}
                className="flex flex-col gap-2 rounded-2xl border border-emerald-400/25 bg-[#041017]/80 px-3 py-2 text-[11px] text-emerald-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono uppercase tracking-[0.3em]">{symbol}</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/70">snapshot</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-[0.26em] text-emerald-200/80">session</div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-emerald-200/80">
                      <span>imprint</span>
                      <span className="font-mono text-sm text-emerald-50">
                        {formatNumber(stat.session.imprint, { precision: 3, fallback: "0" })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-emerald-200/80">
                      <span>luggage</span>
                      <span className="font-mono text-sm text-emerald-50">
                        {formatNumber(stat.session.luggage, { precision: 3, fallback: "0" })}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-[0.26em] text-emerald-200/80">cycle</div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-emerald-200/80">
                      <span>imprint</span>
                      <span className="font-mono text-sm text-emerald-50">
                        {formatNumber(stat.cycle.imprint, { precision: 3, fallback: "0" })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-emerald-200/80">
                      <span>luggage</span>
                      <span className="font-mono text-sm text-emerald-50">
                        {formatNumber(stat.cycle.luggage, { precision: 3, fallback: "0" })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/20 bg-black/30 px-3 py-4 text-sm text-emerald-200/70">
            CIN auxiliary data unavailable for the current selection.
          </div>
        )}
      </div>
    </DynamicsCard>
  );
}
