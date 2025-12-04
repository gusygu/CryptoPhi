"use client";

import React from "react";
import { type FrozenStage } from "@/components/features/matrices/colors";

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

type Props = {
  rows: ApiMatrixRow[];
  /** Optional 24h values from API to display as numeric text. */
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

const fmtPct = (value: number | null) =>
  value == null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(2)}%`;
const fmtNum = (value: number | null, digits = 6) => {
  if (value == null || !Number.isFinite(value)) return "-";
  const s = value.toFixed(digits);
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.$/, "");
};

export default function MatricesTable({ rows, pct24hValues }: Props) {
  return (
    <div className="overflow-auto rounded-2xl border border-white/10 bg-slate-950/50">
      <table className="min-w-full border-separate border-spacing-y-1 text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-400/80">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Pair</th>
            <th className="px-3 py-2 text-left font-semibold">Benchmark</th>
            <th className="px-3 py-2 text-left font-semibold">24h %</th>
            <th className="px-3 py-2 text-left font-semibold">pct_ref</th>
            <th className="px-3 py-2 text-left font-semibold">ref</th>
            <th className="px-3 py-2 text-left font-semibold">id_pct</th>
            <th className="px-3 py-2 text-left font-semibold">pct_drv</th>
            <th className="px-3 py-2 text-left font-semibold">delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pct24 =
              pct24hValues?.[row.base]?.[row.quote] ??
              row.benchmark_pct24h.bottom.value ??
              null;

            return (
              <tr key={row.pair} className="transition hover:bg-white/5">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className={`sym px-2 py-1 text-xs font-semibold tracking-widest ${ringClass(row.symbolRing)}`}>
                      {row.base}
                    </div>
                    <div className="text-xs text-slate-400">{row.pair}</div>
                  </div>
                </td>

                <TableCell color={row.benchmark_pct24h.top.color} value={fmtNum(row.benchmark_pct24h.top.value)} />
                <TableCell
                  color={row.benchmark_pct24h.bottom.color}
                  value={fmtPct(pct24)}
                />
                <TableCell color={row.ref_block.top.color} value={fmtPct(row.ref_block.top.value)} />
                <TableCell color={row.ref_block.bottom.color} value={fmtPct(row.ref_block.bottom.value)} />
                <TableCell color={row.id_pct.color} value={fmtPct(row.id_pct.value)} />
                <TableCell color={row.pct_drv.color} value={fmtPct(row.pct_drv.value)} />
                <TableCell color={row.delta.color} value={fmtNum(row.delta.value)} />
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-xs text-slate-400/80">
                No matrix rows yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <style jsx>{`
        .sym {
          position: relative;
          width: 56px;
          height: 32px;
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
          border-radius: 6px;
          line-height: 1.2;
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
      `}</style>
    </div>
  );
}

function TableCell({ color, value }: { color: string; value: string }) {
  return (
    <td className="px-3 py-2 font-mono tabular-nums text-[13px]">
      <div className="cell" style={{ background: color || "rgba(15,23,42,0.65)" }}>
        {value}
      </div>
    </td>
  );
}
