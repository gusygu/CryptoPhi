"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { DynamicsCard } from "@/components/features/dynamics/DynamicsCard";
import { classNames, formatNumber, formatPercent, uniqueUpper } from "@/components/features/dynamics/utils";
import { colorForChange, colorForMooDelta, withAlpha, type FrozenStage } from "@/components/features/matrices/colors";

type Grid = Array<Array<number | null>>;

export type DynamicsMatrixProps = {
  coins: string[];
  /** id_pct grid (base x quote) */
  idPct?: Grid;
  /** moo_aux (mea) grid (base x quote) */
  mea?: Grid;
  /** reference grid (ref) */
  refGrid?: Grid;
  /** pct_traded (using pct24h or traded %) grid */
  pctTraded?: Grid;
  /** Symbols that come from API payload (used to mark bridged/anti-symmetric) */
  payloadSymbols?: string[];
  /** Preview symbols available live; drives the green rings */
  previewSet?: Set<string>;
  /** Preview metadata (availability/bridged/antisym) per symbol */
  previewInfo?: Map<
    string,
    { available?: boolean; bridged?: boolean; antisym?: boolean; reason?: string | null }
  >;
  /** Allowed symbols (if provided) to gate clicks */
  allowedSymbols?: Set<string>;
  /** Optional frozen stage resolver (based on previous cycles) */
  freezeStageFor?: (base: string, quote: string) => FrozenStage | null;
  selected?: { base: string; quote: string } | null;
  lastUpdated?: number | string | Date | null;
  loading?: boolean;
  onSelect?: (payload: { base: string; quote: string; value: number | null; metric: "id_pct" | "moo" }) => void;
  className?: string;
};

const ZERO_FLOOR = 1e-9;
const MOO_ZERO_FLOOR = 1e-9;
const NULL_BG = "rgba(250,204,21,0.2)";
const NULL_TEXT = "#422006";

const ensureUpper = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase();

function valueFromGrid(grid: Grid | undefined, i: number, j: number): number | null {
  const v = grid?.[i]?.[j];
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatRelative(ts?: number | string | Date | null): string {
  if (ts == null) return "n/a";
  const millis =
    ts instanceof Date
      ? ts.getTime()
      : typeof ts === "string"
      ? Number.isFinite(Date.parse(ts))
        ? Date.parse(ts)
        : NaN
      : ts;
  if (!Number.isFinite(millis)) return "n/a";
  const delta = Math.max(0, Date.now() - Number(millis));
  const secs = Math.floor(delta / 1_000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function textForValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return formatNumber(value, { precision: 7, minimumFractionDigits: 7, fallback: "-" });
}

export default function DynamicsMatrix({
  coins,
  idPct,
  mea,
  refGrid,
  pctTraded,
  payloadSymbols,
  previewSet,
  previewInfo,
  allowedSymbols,
  freezeStageFor,
  selected,
  lastUpdated,
  loading,
  onSelect,
  className,
}: DynamicsMatrixProps) {
  const rows = useMemo(() => uniqueUpper(coins ?? []), [coins]);
  const cols = rows;
  const preview = useMemo(() => previewSet ?? new Set<string>(), [previewSet]);
  const previewMeta = useMemo(() => previewInfo ?? new Map(), [previewInfo]);
  const payload = useMemo(() => {
    if (!payloadSymbols?.length) return new Set<string>();
    return new Set(payloadSymbols.map(ensureUpper));
  }, [payloadSymbols]);
  const prevMooRef = useRef<Map<string, number>>(new Map());
  const gridKey = useMemo(() => rows.join("|"), [rows]);

  const columnCount = cols.length || 1;
  const cellWidth = Math.max(44, Math.min(68, Math.floor(600 / Math.max(columnCount * 1.1, 1))));
  const rowHeaderWidth = Math.max(64, Math.min(110, Math.floor(cellWidth * 1.25)));

  const selectedBase = ensureUpper(selected?.base);
  const selectedQuote = ensureUpper(selected?.quote);

        const status = loading ? "Loading dynamics..." : `Snapshot - ${formatRelative(lastUpdated ?? null)}`;

  const ringFor = (base: string, quote: string): string => {
    const sym = `${base}${quote}`;
    const inverse = `${quote}${base}`;
    const meta = previewMeta.get(sym) ?? previewMeta.get(inverse);
    if (meta?.available) return "#22c55e";
    if (meta?.antisym) return "#f97316";
    if (meta?.bridged) return "#cbd5e1";
    if (preview.has(sym)) return "#22c55e";
    if (preview.has(inverse)) return "#f97316";
    if (payload.has(sym) || payload.has(inverse)) return "#94a3b8";
    return "#94a3b8";
  };

  useEffect(() => {
    const next = new Map<string, number>();
    rows.forEach((base, i) => {
      cols.forEach((quote, j) => {
        if (base === quote) return;
        const val = valueFromGrid(mea, i, j);
        if (val == null || !Number.isFinite(val)) return;
        next.set(`${base}|${quote}`, Number(val));
      });
    });
    prevMooRef.current = next;
  }, [mea, gridKey, rows, cols]);

  const lineColorForMoo = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return "rgba(148,163,184,0.35)";
    return value >= 0 ? "rgba(56,189,248,0.85)" : "rgba(249,115,22,0.85)";
  };

  const lineColorForRef = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return "rgba(148,163,184,0.35)";
    return value >= 0 ? "rgba(94,234,212,0.7)" : "rgba(244,114,182,0.7)";
  };

  const lineColorForPct = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return "rgba(148,163,184,0.35)";
    return value >= 0 ? "rgba(74,222,128,0.8)" : "rgba(248,113,113,0.8)";
  };

  const renderCell = (i: number, j: number) => {
    const base = rows[i]!;
    const quote = cols[j]!;
    if (base === quote) {
      return (
        <td key={`${base}-${quote}`} className="p-0.5" style={{ minWidth: cellWidth }}>
          <div className="flex min-h-[60px] items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/40 text-[10px] text-slate-500">
            —
          </div>
        </td>
      );
    }

    const stage = freezeStageFor?.(base, quote) ?? null;
    const idVal = valueFromGrid(idPct, i, j);
    const mooVal = valueFromGrid(mea, i, j);
    const refVal = valueFromGrid(refGrid, i, j);
    const pctVal = valueFromGrid(pctTraded, i, j);
    const prevMoo = prevMooRef.current.get(`${base}|${quote}`) ?? null;

    const ringColor = ringFor(base, quote);
    const idColor = colorForChange(idVal, { frozenStage: stage ?? undefined, zeroFloor: ZERO_FLOOR });
    const mooBase = colorForMooDelta(
      mooVal,
      prevMoo,
      { frozenStage: stage ?? undefined, zeroFloor: MOO_ZERO_FLOOR }
    );
    const mooBg = mooBase ? withAlpha(mooBase, 0.9) : NULL_BG;
    const refColor = lineColorForRef(refVal);
    const pctColor = lineColorForPct(pctVal);
    const pairAllowed =
      allowedSymbols == null ||
      allowedSymbols.has(`${base}${quote}`) ||
      allowedSymbols.has(`${quote}${base}`);

    const isSelected = selectedBase === base && selectedQuote === quote;

    return (
      <td key={`${base}-${quote}`} className="p-0.5 align-top" style={{ minWidth: cellWidth }}>
        <button
          type="button"
          disabled={!pairAllowed}
          onClick={() => onSelect?.({ base, quote, value: idVal, metric: "id_pct" })}
          className={classNames(
            "group flex h-full w-full flex-col gap-0.5 rounded-lg border bg-[#03070f]/90 px-1 py-1 text-left transition",
            pairAllowed ? "hover:-translate-y-0.5 hover:shadow-[0_8px_18px_rgba(14,116,144,0.16)]" : "cursor-not-allowed opacity-60"
          )}
          style={{
            borderColor: withAlpha(ringColor, 0.55),
            boxShadow: isSelected
              ? `0 0 0 2px ${withAlpha("#38bdf8", 0.65)}, inset 0 0 0 1px ${withAlpha(ringColor, 0.35)}`
              : `inset 0 0 0 1px ${withAlpha(ringColor, 0.22)}`,
          }}
        >
          <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-[0.2em] text-slate-200">
            <i
              className="h-2 w-2 rounded-full"
              style={{
                background: ringColor,
                boxShadow: `0 0 8px ${withAlpha(ringColor, 0.55)}`,
              }}
            />
            <span className="font-mono text-[10px] text-slate-200">
              {base}/{quote}
            </span>
          </div>
          <div
            className="w-full rounded-md border px-1.5 py-[2px] font-mono text-[10px] tabular-nums leading-tight"
            style={{
              background: mooBg,
              borderColor: withAlpha(ringColor, 0.18),
              color: mooVal == null || !Number.isFinite(mooVal) ? NULL_TEXT : "#02131f",
            }}
          >
            {textForValue(mooVal)}
          </div>
          <div
            className="w-full rounded-md border px-1.5 py-[2px] font-mono text-[10px] tabular-nums leading-tight"
            style={{
              background: withAlpha(idColor, 0.9),
              borderColor: withAlpha(ringColor, 0.2),
              color: "#e2e8f0",
            }}
          >
            {textForValue(idVal)}
          </div>
          <div
            className="w-full rounded-md border px-1.5 py-[2px] font-mono text-[10px] tabular-nums leading-tight"
            style={{
              background: withAlpha(refColor, 0.18),
              borderColor: withAlpha(refColor, 0.35),
              color: "#e2e8f0",
            }}
          >
            {textForValue(refVal)}
          </div>
          <div
            className="w-full rounded-md border px-1.5 py-[2px] font-mono text-[10px] tabular-nums leading-tight"
            style={{
              background: withAlpha(pctColor, 0.18),
              borderColor: withAlpha(pctColor, 0.35),
              color: "#e2e8f0",
            }}
          >
            {textForValue(pctVal)}
          </div>
        </button>
      </td>
    );
  };

  return (
    <DynamicsCard
      title="Dynamics matrix"
      subtitle="id_pct and moo_aux"
      status={status}
      className={classNames(
        "rounded-[22px] border border-emerald-400/20 bg-[#02070e]/95 shadow-[0_18px_42px_rgba(0,0,0,0.45)] backdrop-blur",
        className
      )}
      contentClassName="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-emerald-50/80">
        <span className="rounded-full border border-emerald-300/40 bg-emerald-300/10 px-2 py-[2px]">id_pct header</span>
        <span className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-2 py-[2px]">moo header</span>
        <span className="rounded-full border border-emerald-400/50 px-2 py-[2px] text-emerald-50/80">
          Green ring: preview
        </span>
        <span className="rounded-full border border-amber-400/60 px-2 py-[2px] text-amber-50">
          Orange ring: anti-sym
        </span>
        <span className="rounded-full border border-slate-400/50 px-2 py-[2px] text-emerald-50/80">
          Grey ring: bridged
        </span>
        <span className="rounded-full border border-purple-400/60 px-2 py-[2px] text-emerald-50/80">
          Purple fill: frozen
        </span>
        <span className="rounded-full border border-amber-400/50 px-2 py-[2px] text-amber-100/90">Amber: |v| &lt; 1e-9</span>
      </div>

      <div className="flex-1 rounded-[18px] border border-emerald-400/15 bg-[#01050b]/85 p-1 shadow-[inset_0_1px_0_rgba(94,234,212,0.15)] overflow-auto">
        {rows.length === 0 || cols.length === 0 ? (
          <div className="px-4 py-8 text-sm text-emerald-200/70">Matrix data unavailable.</div>
        ) : (
          <div className="overflow-x-auto rounded-[14px]">
            <table className="w-full table-fixed border-separate border-spacing-0 text-[10px] leading-tight">
              <thead className="sticky top-0 z-10 bg-[#03101a]/95 text-emerald-50/70 backdrop-blur">
                <tr>
                  <th
                    className="px-3 py-1.5 text-left font-semibold uppercase tracking-[0.2em] text-emerald-50/80"
                    style={{ width: rowHeaderWidth, minWidth: rowHeaderWidth }}
                  >
                    Base / headers
                  </th>
                  {cols.map((coin, idx) => (
                    <th
                      key={`head-${coin}`}
                      className="px-1 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-50/70"
                      style={{ width: cellWidth }}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="block truncate">{coin}</span>
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-[1px] text-[9px] text-emerald-100/80">
                          id_pct {textForValue(idPct?.[idx]?.[idx + 1] ?? null)}
                        </span>
                        <span className="rounded-full bg-cyan-500/15 px-1.5 py-[1px] text-[9px] text-cyan-100/80">
                          moo {textForValue(mea?.[idx]?.[idx + 1] ?? null)}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((base, rowIdx) => (
                  <tr key={base}>
                    <th
                      scope="row"
                      className="bg-[#03101a]/70 px-3 py-1.5 text-left font-semibold uppercase tracking-[0.24em] text-emerald-50"
                      style={{ width: rowHeaderWidth, minWidth: rowHeaderWidth }}
                    >
                      <div className="flex flex-col gap-1">
                        <span>{base}</span>
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-[1px] text-[9px] text-emerald-100/80">
                          id_pct {textForValue(idPct?.[rowIdx]?.[rowIdx] ?? null)}
                        </span>
                        <span className="rounded-full bg-cyan-500/15 px-1.5 py-[1px] text-[9px] text-cyan-100/80">
                          moo {textForValue(mea?.[rowIdx]?.[rowIdx] ?? null)}
                        </span>
                      </div>
                    </th>
                    {cols.map((_, colIdx) => renderCell(rowIdx, colIdx))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DynamicsCard>
  );
}
