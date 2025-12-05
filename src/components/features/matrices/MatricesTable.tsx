"use client";

import React, { useMemo } from "react";
import {
  colorForChange,
  withAlpha,
  type FrozenStage,
} from "@/components/features/matrices/colors";

type Ring = "green" | "red" | "grey" | "purple";
type Derivation = "direct" | "inverse" | "bridged";
type Cell = {
  value: number | null;
  color: string;
  derivation?: Derivation;
  ring?: Ring;
};
type DualRow = { top: Cell; bottom: Cell };

export type ApiMatrixRow = {
  pair: string;
  base: string;
  quote: string;
  derivation: Derivation;
  ring: Ring;
  symbolRing: Ring;
  symbolFrozen: boolean;
  benchmark_pct24h: DualRow;
  ref_block: DualRow;
  snap_block?: DualRow;
  delta: Cell;
  id_pct: Cell;
  pct_drv: Cell;
  meta?: { frozen?: boolean; frozenStage?: FrozenStage | null };
};

export type MatrixValues = Record<string, Record<string, number | null>>;

export type TableColumn = {
  key: string;
  label: string;
  width?: string;
  align?: "left" | "right";
  getter: (row: ApiMatrixRow) => Cell | null | undefined;
  formatter?: (value: number | null) => string;
};

type Props = {
  rows: ApiMatrixRow[];
  columns?: TableColumn[];
  title?: string;
  subtitle?: string;
  /** Optional 24h values override from API to display as numeric text. */
  pct24hValues?: Record<string, Record<string, number | null>>;
};

const ringClass = (ring: Ring) =>
  ring === "green"
    ? "ring ring-emerald-400"
    : ring === "red"
    ? "ring ring-rose-500"
    : ring === "purple"
    ? "ring ring-purple-400"
    : "ring ring-slate-500";

const fmtPercent = (value: number | null, digits = 4) =>
  value == null || !Number.isFinite(value)
    ? "-"
    : `${(value * 100).toFixed(digits)}%`;

const fmtDecimal = (value: number | null, digits = 7) => {
  if (value == null || !Number.isFinite(value)) return "-";
  const s = value.toFixed(digits);
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.$/, "");
};

const DEFAULT_COLUMNS: TableColumn[] = [
  {
    key: "benchmark",
    label: "Benchmark",
    width: "100px",
    getter: (row) => row.benchmark_pct24h.top,
    formatter: (v) => fmtDecimal(v, 7),
  },
  {
    key: "pct24h",
    label: "24h %",
    width: "100px",
    getter: (row) => row.benchmark_pct24h.bottom,
    formatter: (v) => fmtPercent(v, 4),
  },
  {
    key: "pct_ref",
    label: "pct_ref",
    width: "100px",
    getter: (row) => row.ref_block.top,
    formatter: (v) => fmtPercent(v, 4),
  },
  {
    key: "ref",
    label: "ref",
    width: "100px",
    getter: (row) => row.ref_block.bottom,
    formatter: (v) => fmtDecimal(v, 7),
  },
  {
    key: "pct_snap",
    label: "pct_snap",
    width: "100px",
    getter: (row) => row.snap_block?.top,
    formatter: (v) => fmtPercent(v, 4),
  },
  {
    key: "snap",
    label: "snap",
    width: "100px",
    getter: (row) => row.snap_block?.bottom,
    formatter: (v) => fmtDecimal(v, 7),
  },
];

export default function MatricesTable({
  rows,
  columns,
  title,
  subtitle,
  pct24hValues,
}: Props) {
  const cols = useMemo(
    () => (columns?.length ? columns : DEFAULT_COLUMNS),
    [columns]
  );

  const resolvedRows = useMemo(() => {
    if (!pct24hValues) return rows;
    return rows.map((row) => {
      const override = pct24hValues?.[row.base]?.[row.quote];
      if (override == null || !Number.isFinite(override)) return row;
      return {
        ...row,
        benchmark_pct24h: {
          ...row.benchmark_pct24h,
          bottom: { ...row.benchmark_pct24h.bottom, value: override },
        },
      };
    });
  }, [rows, pct24hValues]);

  return (
    <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-4 shadow-[0_35px_120px_-60px_rgba(8,47,73,0.75)]">
      {(title || subtitle) && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          {title ? (
            <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {subtitle ? (
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              {subtitle}
            </span>
          ) : null}
        </header>
      )}
      <div className="overflow-auto">
        <table className="min-w-full table-fixed border-separate border-spacing-y-1 text-[13px] leading-tight">
          <colgroup>
            <col style={{ width: "140px" }} />
            {cols.map((col) => (
              <col key={col.key} style={{ width: col.width ?? "100px" }} />
            ))}
          </colgroup>
          <thead className="text-[11px] uppercase tracking-[0.18em] text-slate-400/85">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Pair</th>
              {cols.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left font-semibold"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resolvedRows.map((row) => (
              <tr
                key={row.pair}
                className="rounded-xl transition hover:bg-white/5"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`sym px-2 py-1 text-[11px] font-semibold tracking-[0.25em] ${ringClass(
                        row.symbolRing
                      )}`}
                    >
                      {row.base}
                    </div>
                    <div className="min-w-[86px] text-xs text-slate-300">
                      {row.pair}
                    </div>
                  </div>
                </td>

                {cols.map((col) => {
                  const cell = col.getter(row);
                  const formatted = col.formatter
                    ? col.formatter(cell?.value ?? null)
                    : fmtDecimal(cell?.value ?? null, 7);
                  return (
                    <TableCell
                      key={`${row.pair}-${col.key}`}
                      color={cell?.color ?? "rgba(15,23,42,0.75)"}
                      value={formatted}
                      align={col.align}
                    />
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={cols.length + 1}
                  className="px-3 py-4 text-center text-xs text-slate-400/80"
                >
                  No matrix rows yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .sym {
          position: relative;
          width: 60px;
          height: 30px;
          border-radius: 16px;
          background: #0b1120;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #e2e8f0;
        }
        .ring::before {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 20px;
          border: 3px solid transparent;
        }
        .ring-emerald-400::before {
          border-color: #4ade80;
        }
        .ring-rose-500::before {
          border-color: #fb7185;
        }
        .ring-slate-500::before {
          border-color: #94a3b8;
        }
        .ring-purple-400::before {
          border-color: #a855f7;
        }
        .cell {
          width: 100%;
          padding: 8px 10px;
          border-radius: 9px;
          line-height: 1.2;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
          background: rgba(15, 23, 42, 0.7);
        }
      `}</style>
    </div>
  );
}

function TableCell({
  color,
  value,
  align = "right",
}: {
  color: string;
  value: string;
  align?: "left" | "right";
}) {
  const bg = color ? withAlpha(color, 0.82) : "rgba(15,23,42,0.7)";
  return (
    <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
      <div
        className="cell"
        style={{
          background: bg,
          color: "#e2e8f0",
          textAlign: align,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), 0 0 14px ${withAlpha(
            color,
            0.35
          )}`,
        }}
      >
        {value}
      </div>
    </td>
  );
}

export type MatrixGridTableProps = {
  title: string;
  subtitle?: string;
  metric: string;
  coins: string[];
  values?: MatrixValues;
  isPercent?: boolean;
  zeroFloor: number;
  freezeStageFor?: (
    metric: string,
    base: string,
    quote: string
  ) => FrozenStage | null;
};

const matrixValue = (
  values: MatrixValues | undefined,
  base: string,
  quote: string
): number | null => {
  const raw = values?.[base]?.[quote];
  if (raw == null) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

export function MatrixGridTable({
  title,
  subtitle,
  metric,
  coins,
  values,
  isPercent = false,
  zeroFloor,
  freezeStageFor,
}: MatrixGridTableProps) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3 shadow-[0_35px_120px_-60px_rgba(8,47,73,0.75)]">
      <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-100">
          {title}
        </h3>
        {subtitle ? (
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            {subtitle}
          </span>
        ) : null}
      </div>

      <div className="overflow-auto">
        <table className="min-w-full table-fixed border-separate border-spacing-[6px] text-[12px] leading-tight">
          <colgroup>
            <col style={{ width: "86px" }} />
            {coins.map((c) => (
              <col key={`col-${c}`} style={{ width: "92px" }} />
            ))}
          </colgroup>
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.16em] text-slate-400/85">
              <th className="px-2 py-1 text-left font-semibold">base/quote</th>
              {coins.map((c) => (
                <th key={`h-${c}`} className="px-2 py-1 text-center font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coins.map((base) => (
              <tr key={`row-${base}`} className="text-center text-[12px]">
                <th className="px-2 py-1 text-left font-semibold text-slate-300">
                  {base}
                </th>
                {coins.map((quote) => {
                  if (base === quote) {
                    return (
                      <td key={`${base}-${quote}`} className="px-2 py-1">
                        <div className="rounded-lg border border-white/5 bg-slate-900/50 px-2 py-1.5 text-[11px] text-slate-500">
                          —
                        </div>
                      </td>
                    );
                  }
                  const val = matrixValue(values, base, quote);
                  const stage = freezeStageFor?.(metric, base, quote) ?? null;
                  const color = colorForChange(val, {
                    frozenStage: stage ?? undefined,
                    zeroFloor,
                  });
                  const display = isPercent
                    ? fmtPercent(val, 4)
                    : fmtDecimal(val, 7);
                  return (
                    <td key={`${base}-${quote}`} className="px-2 py-1">
                      <div
                        className="rounded-lg border border-white/7 px-2 py-1.5 font-mono tabular-nums text-[12px]"
                        style={{
                          background: withAlpha(color, 0.82),
                          color: "#e2e8f0",
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), 0 0 12px ${withAlpha(
                            color,
                            0.3
                          )}`,
                        }}
                      >
                        {display}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!coins.length && (
              <tr>
                <td
                  colSpan={coins.length + 1}
                  className="px-2 py-3 text-center text-xs text-slate-400/80"
                >
                  No coins available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
