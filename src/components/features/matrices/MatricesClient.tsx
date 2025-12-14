"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatrixGridTable, type ApiMatrixRow as TableMatrixRow } from "./MatricesTable";
import MooAuxCard from "@/components/features/moo-aux/MooAuxCard";
import { colorForBenchmarkDelta, colorForChange, withAlpha, type FrozenStage } from "@/components/features/matrices/colors";
import { useSettings } from "@/lib/settings/client";
import { loadPreviewSymbolSet } from "@/components/features/matrices/colouring";
import { getBrowserBadge } from "@/lib/client/badge";
import { useParams } from "next/navigation";

type MatrixValues = Record<string, Record<string, number | null>>;

type MatrixFlags = {
  frozen?: boolean[][];
  frozenSymbols?: Record<string, boolean>;
};

type MatrixSlice = {
  ts?: number;
  values?: MatrixValues;
  flags?: MatrixFlags;
};

type MatricesLatestResponse = {
  ok?: boolean;
  error?: string;
  coins?: string[];
  symbols?: string[];
  quote?: string;
  window?: "15m" | "30m" | "1h";
  matrices?: {
    benchmark?: MatrixSlice;
    pct24h?: { values?: MatrixValues };
    id_pct?: { values?: MatrixValues };
    pct_drv?: { values?: MatrixValues };
    pct_ref?: { values?: MatrixValues };
    ref?: { values?: MatrixValues };
    delta?: { values?: MatrixValues };
    pct_snap?: { values?: MatrixValues };
    snap?: { values?: MatrixValues };
    pct_traded?: { values?: MatrixValues };
    traded?: { values?: MatrixValues };
  };
  // optional top-level ts
  ts?: number;
  meta?: {
    openingTs?: number | null;
    snapshotTs?: number | null;
    tradeTs?: number | null;
  };
};

type UiMatrixRow = TableMatrixRow;

const DEFAULT_POLL_INTERVAL_MS = 80_000;
const FREEZE_DELTA_EPS = 1e-10;
const ZERO_FLOOR_DECIMAL = 1e-9;
const ZERO_FLOOR_PERCENT = 1e-7;
const WINDOW_TO_MS: Record<"15m" | "30m" | "1h", number> = {
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

const normalizeKey = (value: string) => String(value ?? "").toUpperCase();

const toUpper = (token: string | null | undefined) =>
  String(token ?? "").trim().toUpperCase();

const getMatrixValue = (
  matrix: MatrixValues | undefined,
  base: string,
  quote: string
): number | null => {
  const raw = matrix?.[base]?.[quote];
  if (raw == null) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

type BuildRowsArgs = {
  payload: MatricesLatestResponse | null;
  previewSet: Set<string>;
  freezeStageFor: (metric: string, base: string, quote: string) => FrozenStage | null;
  previousValueFor: (metric: string, base: string, quote: string) => number | null;
};

function buildMatrixRows({ payload, previewSet, freezeStageFor, previousValueFor }: BuildRowsArgs): UiMatrixRow[] {
  if (!payload?.ok) return [];

  const quote = toUpper(payload.quote ?? "USDT");
  const coinsRaw = Array.isArray(payload.coins) ? payload.coins.map(toUpper) : [];
  const coins = coinsRaw.filter((c) => c && c !== quote);
  const fullCoins = [quote, ...coins];

  const symbolsSet = new Set((payload.symbols ?? []).map(toUpper));
  const benchmarkSlice = payload.matrices?.benchmark;
  const flags = (benchmarkSlice?.flags ?? {}) as MatrixFlags;
  const pct24Values = payload.matrices?.pct24h?.values ?? {};
  const idValues = payload.matrices?.id_pct?.values ?? {};
  const drvValues = payload.matrices?.pct_drv?.values ?? {};
  const pctRefValues = payload.matrices?.pct_ref?.values ?? {};
  const refValues = payload.matrices?.ref?.values ?? {};
  const pctSnapValues = payload.matrices?.pct_snap?.values ?? {};
  const snapValues = payload.matrices?.snap?.values ?? {};
  const deltaValues = payload.matrices?.delta?.values ?? {};
  const pctTradedValues = payload.matrices?.pct_traded?.values ?? {};
  const tradedValues = payload.matrices?.traded?.values ?? {};
  const benchValues = benchmarkSlice?.values ?? {};

  return coins.map((base) => {
    const idStage = freezeStageFor("id_pct", base, quote);
    const benchStage = idStage ?? freezeStageFor("benchmark", base, quote);
    const pct24Stage = freezeStageFor("pct24h", base, quote);
    const refStage = freezeStageFor("pct_ref", base, quote);
    const refValStage = freezeStageFor("ref", base, quote);
    const snapPctStage = freezeStageFor("pct_snap", base, quote);
    const snapStage = freezeStageFor("snap", base, quote);
    const tradePctStage = freezeStageFor("pct_traded", base, quote);
    const tradeStage = freezeStageFor("traded", base, quote);
    const deltaStage = freezeStageFor("delta", base, quote);
    const frozen = Boolean(
      idStage ||
        benchStage ||
        pct24Stage ||
        refStage ||
        refValStage ||
        snapPctStage ||
        snapStage ||
        tradePctStage ||
        tradeStage ||
        deltaStage
    );

    const directSymbol = `${base}${quote}`;
    const inverseSymbol = `${quote}${base}`;
    const derivation = symbolsSet.has(directSymbol)
      ? "direct"
      : symbolsSet.has(inverseSymbol)
      ? "inverse"
      : "bridged";

    const symbolRing: UiMatrixRow["symbolRing"] =
      previewSet.has(directSymbol)
        ? "green"
        : previewSet.has(inverseSymbol) || derivation === "inverse"
        ? "red"
        : "grey";

    const benchmarkValue = getMatrixValue(benchValues, base, quote);
    const pct24 = getMatrixValue(pct24Values, base, quote);
    const idPct = getMatrixValue(idValues, base, quote);
    const pctDrv = getMatrixValue(drvValues, base, quote);
    const pctRef = getMatrixValue(pctRefValues, base, quote);
    const refVal = getMatrixValue(refValues, base, quote);
    const pctSnap = getMatrixValue(pctSnapValues, base, quote);
    const snapVal = getMatrixValue(snapValues, base, quote);
    const deltaVal = getMatrixValue(deltaValues, base, quote);
    const pctTraded = getMatrixValue(pctTradedValues, base, quote);
    const tradedVal = getMatrixValue(tradedValues, base, quote);

    // Trade-direction ring:
    //  frozen → purple
    //  benchmark > 1 → green (base > quote)
    //  benchmark < 1 → red   (base < quote)
    //  else → grey
    const pairRing: UiMatrixRow["ring"] = symbolRing;

    // Color fields:
    //  decimals: zeroFloor ~ 1e-9 (amber floors at 1e-7)
    //  percentages: zeroFloor = 1e-7 (0.00001%)
    const prevBenchmark = previousValueFor("benchmark", base, quote);
    const prevIdPct = previousValueFor("id_pct", base, quote);
    const benchmarkColor =
      prevBenchmark != null
        ? colorForBenchmarkDelta(benchmarkValue, prevBenchmark, {
            frozenStage: benchStage ?? undefined,
            idFrozenStage: idStage ?? undefined,
            zeroFloor: ZERO_FLOOR_DECIMAL,
            idPct,
            prevIdPct,
          })
        : colorForChange(
            benchmarkValue == null ? null : benchmarkValue - 1,
            { frozenStage: benchStage ?? undefined, zeroFloor: ZERO_FLOOR_DECIMAL }
          );
    const pctColor = colorForChange(pct24, {
      frozenStage: pct24Stage ?? undefined,
      zeroFloor: ZERO_FLOOR_PERCENT,
    });
    const idColor = colorForChange(idPct, {
      frozenStage: idStage ?? undefined,
      zeroFloor: ZERO_FLOOR_DECIMAL,
    });
    const drvColor = colorForChange(pctDrv, {
      frozenStage: idStage ?? undefined,
      zeroFloor: ZERO_FLOOR_DECIMAL,
    });
    const refColor = colorForChange(pctRef, {
      frozenStage: refStage ?? undefined,
      zeroFloor: ZERO_FLOOR_PERCENT,
    });
    const refValColor = colorForChange(refVal, {
      frozenStage: refValStage ?? undefined,
      zeroFloor: ZERO_FLOOR_DECIMAL,
    });
    const pctSnapColor = colorForChange(pctSnap, {
      frozenStage: snapPctStage ?? undefined,
      zeroFloor: ZERO_FLOOR_PERCENT,
    });
    const snapColor = colorForChange(snapVal, {
      frozenStage: snapStage ?? undefined,
      zeroFloor: ZERO_FLOOR_DECIMAL,
    });
    const pctTradedColor = colorForChange(pctTraded, {
      frozenStage: tradePctStage ?? undefined,
      zeroFloor: ZERO_FLOOR_PERCENT,
    });
    const tradedColor = colorForChange(tradedVal, {
      frozenStage: tradeStage ?? undefined,
      zeroFloor: ZERO_FLOOR_DECIMAL,
    });
    const deltaColor = colorForChange(deltaVal, {
      frozenStage: deltaStage ?? undefined,
      zeroFloor: ZERO_FLOOR_DECIMAL,
    });

    return {
      pair: `${base}/${quote}`,
      base,
      quote,
      derivation,
      ring: pairRing,
      symbolRing,
      symbolFrozen: frozen,
      benchmark_pct24h: {
        top: { value: benchmarkValue, color: benchmarkColor, derivation, ring: pairRing },
        bottom: { value: pct24, color: pctColor, derivation, ring: pairRing },
      },
      ref_block: {
        top: { value: pctRef, color: refColor, derivation, ring: pairRing },
        bottom: { value: refVal, color: refValColor, derivation, ring: pairRing },
      },
      snap_block:
        pctSnap == null && snapVal == null
          ? undefined
          : {
              top: { value: pctSnap, color: pctSnapColor, derivation, ring: pairRing },
              bottom: { value: snapVal, color: snapColor, derivation, ring: pairRing },
            },
      trade_block:
        pctTraded == null && tradedVal == null
          ? undefined
          : {
              top: { value: pctTraded, color: pctTradedColor, derivation, ring: pairRing },
              bottom: { value: tradedVal, color: tradedColor, derivation, ring: pairRing },
            },
      delta: { value: deltaVal, color: deltaColor, derivation, ring: pairRing },
      id_pct: { value: idPct, color: idColor, derivation, ring: pairRing },
      pct_drv: { value: pctDrv, color: drvColor, derivation, ring: pairRing },
      meta: { frozen, frozenStage: idStage },
    };
  });
}

const RING_LEGEND = [
    { label: "preview available", color: "#22c55e" },
    { label: "anti-symmetrized", color: "#ef4444" },
    { label: "bridged/missing", color: "#94a3b8" },
    { label: "frozen cycles", color: "#7c3aed" },
    { label: "near-flat |value| <= 1e-7", color: "#facc15", square: true },
  ];

function formatTimestamp(ts?: number | null): string {
  if (!ts && ts !== 0) return "-";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, { hour12: false });
}

function ordinalFromTimestamp(ts: number | null | undefined, stepMs: number): number | null {
  if (!Number.isFinite(ts) || stepMs <= 0) return null;
  return Math.floor(Number(ts) / stepMs);
}

function relativeOrdinal(
  current: number | null | undefined,
  opening: number | null | undefined,
  stepMs: number
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(opening) || stepMs <= 0) return null;
  const delta = Number(current) - Number(opening);
  if (delta < 0) return null;
  return Math.floor(delta / stepMs) + 1;
}

type MoodSnapshot = {
  score: number | null;
  amplitude: number | null;
  label: string;
  accent: string;
  description: string;
  buckets: { positive: number; negative: number; neutral: number; total: number };
  dominance: number | null;
};

const ZERO_FLOOR = 1e-9; // decimal sensitivity for mood bucketing

const MOOD_LEVELS: Array<{
  max: number;
  label: string;
  accent: string;
  description: string;
}> = [
  {
    max: -0.03,
    label: "PANIC",
    accent: "#ef4444",
    description: "Liquidity flight and forced repricing.",
  },
  {
    max: -0.01,
    label: "BEAR",
    accent: "#f97316",
    description: "Downside pressure dominating the grid.",
  },
  {
    max: 0.01,
    label: "NEUTRAL",
    accent: "#38bdf8",
    description: "Bid/ask tension in balance.",
  },
  {
    max: 0.03,
    label: "BULL",
    accent: "#4ade80",
    description: "Accumulation bias with constructive drift.",
  },
  {
    max: Number.POSITIVE_INFINITY,
    label: "EUPHORIA",
    accent: "#a855f7",
    description: "Momentum regime with elevated risk appetite.",
  },
];

const EMPTY_MOOD: MoodSnapshot = {
  score: null,
  amplitude: null,
  label: "NO SIGNAL",
  accent: "#64748b",
  description: "Awaiting stable id_pct readings from matrices.",
  buckets: { positive: 0, negative: 0, neutral: 0, total: 0 },
  dominance: null,
};

function computeMood(rows: UiMatrixRow[]): MoodSnapshot {
  const values = rows
    .map((row) => row.id_pct.value)
    .filter(
      (value): value is number => value != null && Number.isFinite(value)
    );

  if (!values.length) return EMPTY_MOOD;

  const sum = values.reduce((acc, value) => acc + value, 0);
  const avg = sum / values.length;

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  let max = -Infinity;
  let min = Infinity;

  for (const v of values) {
    if (v > max) max = v;
    if (v < min) min = v;

    if (Math.abs(v) < ZERO_FLOOR) {
      neutral += 1;
    } else if (v > 0) {
      positive += 1;
    } else {
      negative += 1;
    }
  }

  const amplitude = max - min;
  const buckets = { positive, negative, neutral, total: values.length };
  const dominance = values.length
    ? (positive - negative) / values.length
    : null;
  const level =
    MOOD_LEVELS.find((entry) => avg <= entry.max) ??
    MOOD_LEVELS[MOOD_LEVELS.length - 1]!;

  return {
    score: avg,
    amplitude,
    label: level.label,
    accent: level.accent,
    description: level.description,
    buckets,
    dominance,
  };
}

type MoodEntry = {
  pair: string;
  value: number;
  color: string;
  derivation: UiMatrixRow["derivation"];
};

function selectTop(
  rows: UiMatrixRow[],
  direction: "winners" | "losers",
  take = 3
): MoodEntry[] {
  const numeric = rows
    .map((row) => ({
      pair: row.pair,
      value: row.id_pct.value,
      color: row.id_pct.color,
      derivation: row.derivation,
    }))
    .filter(
      (entry): entry is MoodEntry =>
        entry.value != null && Number.isFinite(entry.value)
    );

  if (!numeric.length) return [];

  const byDirection =
    direction === "winners"
      ? numeric.filter((entry) => entry.value > ZERO_FLOOR)
      : numeric.filter((entry) => entry.value < -ZERO_FLOOR);

  const pool = byDirection.length ? byDirection : numeric;
  const sorted = [...pool].sort((a, b) =>
    direction === "winners" ? b.value - a.value : a.value - b.value
  );

  return sorted.slice(0, take);
}

const DERIVATION_BADGE: Record<UiMatrixRow["derivation"], string> = {
  direct: "bg-emerald-500/20 text-emerald-200",
  inverse: "bg-rose-500/20 text-rose-200",
  bridged: "bg-slate-500/20 text-slate-200",
};

function textColorForValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "#e2e8f0";
  return value >= 0 ? "#022c22" : "#fef2f2";
}

function formatPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatDecimal(value: number | null, digits = 7): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

type MoodAuxPanelProps = {
  snapshot: MoodSnapshot;
  winners: MoodEntry[];
  losers: MoodEntry[];
  lastUpdated?: number | null;
  totalRows: number;
};

function MoodAuxPanel({
  snapshot,
  winners,
  losers,
  lastUpdated,
  totalRows,
}: MoodAuxPanelProps) {
  const { accent, label, description, score, amplitude, buckets, dominance } =
    snapshot;
  const total = buckets.total || 1;
  const positivePct = (buckets.positive / total) * 100;
  const neutralPct = (buckets.neutral / total) * 100;
  const negativePct = (buckets.negative / total) * 100;

  return (
    <aside
      className="relative flex h-full flex-col gap-6 overflow-hidden rounded-3xl border border-white/12 bg-slate-950/85 p-6 shadow-[0_55px_140px_-60px_rgba(8,47,73,0.7)] backdrop-blur"
      style={{
        boxShadow:
          "0 0 0 1px rgba(148,163,184,0.16), 0 50px 140px -65px rgba(14,116,144,0.55)",
        backgroundImage: `linear-gradient(165deg, ${withAlpha(
          accent,
          0.2
        )}, rgba(2,6,23,0.92))`,
      }}
    >
      <header className="space-y-2">
        <span
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.32em]"
          style={{ background: withAlpha(accent, 0.18), color: accent }}
        >
          mood-aux
        </span>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            {totalRows} pairs &bull; updated {formatTimestamp(lastUpdated)}
          </span>
        </div>
      </header>

      <section className="space-y-4">
        <div className="grid gap-3">
          <MoodStat
            label="Avg id_pct"
            value={formatDecimal(score, 7)}
            accent={accent}
          />
          <MoodStat
            label="Spread width"
            value={formatDecimal(amplitude, 7)}
            accent="#38bdf8"
          />
          <MoodStat
            label="Bias balance"
            value={
              dominance == null
                ? "-"
                : `${(dominance * 100).toFixed(1)}% ${
                    dominance >= 0 ? "bull" : "bear"
                  }`
            }
            accent={dominance != null && dominance >= 0 ? "#4ade80" : "#f87171"}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>Distribution</span>
            <span>
              +{buckets.positive} / &asymp;{buckets.neutral} / -
              {buckets.negative}
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-900/65">
            <div
              style={{
                width: `${positivePct}%`,
                background: withAlpha("#22c55e", 0.85),
              }}
            />
            <div
              style={{
                width: `${neutralPct}%`,
                background: withAlpha("#facc15", 0.65),
              }}
            />
            <div
              style={{
                width: `${negativePct}%`,
                background: withAlpha("#f87171", 0.85),
              }}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <MoodList
          title="Top uplifts"
          entries={winners}
          emptyCopy="No positive id_pct yet."
        />
        <MoodList
          title="Deep pullbacks"
          entries={losers}
          emptyCopy="No negative id_pct yet."
        />
      </section>
    </aside>
  );
}

function MoodStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3"
      style={{
        boxShadow: `0 0 0 1px ${withAlpha(
          accent,
          0.25
        )}, inset 0 1px 0 rgba(255,255,255,0.1)`,
      }}
    >
      <span className="text-[12px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="font-mono text-[15px] text-slate-100">{value}</span>
    </div>
  );
}

function MoodList({
  title,
  entries,
  emptyCopy,
}: {
  title: string;
  entries: MoodEntry[];
  emptyCopy: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
        {title}
      </h3>
      <div className="mt-3 space-y-2">
        {entries.length === 0 && (
          <div className="text-xs text-slate-500">{emptyCopy}</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.pair}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/70 px-3 py-2 text-[13px]"
            style={{
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 12px ${withAlpha(
                entry.color,
                0.4
              )}`,
            }}
          >
            <div className="flex items-center gap-2 font-mono text-[12px] text-slate-200">
              <span>{entry.pair}</span>
              <span
                className={`rounded-full px-2 py-px text-[10px] uppercase ${DERIVATION_BADGE[entry.derivation]}`}
              >
                {entry.derivation}
              </span>
            </div>
            <span
              className="inline-flex min-w-[120px] justify-end rounded-md px-2 py-1 font-mono text-[12px]"
              style={{
                background: withAlpha(entry.color, 0.7),
                color: textColorForValue(entry.value),
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            >
              {formatDecimal(entry.value, 7)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string;
};

function StatCard({ label, value, hint, accent = "#38bdf8" }: StatCardProps) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-slate-950/75 p-4 shadow-[0_25px_60px_-40px_rgba(8,47,73,0.65)]"
      style={{
        boxShadow: `0 0 0 1px ${withAlpha(
          accent,
          0.22
        )}, 0 25px 70px -45px rgba(8,47,73,0.55)`,
      }}
    >
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {hint ? (
        <div className="mt-1 text-[12px] text-slate-500">{hint}</div>
      ) : null}
    </div>
  );
}

type MatricesClientProps = {
  badge?: string;
};

export default function MatricesClient({ badge: badgeProp }: MatricesClientProps) {
  const params = useParams<{ badge?: string }>();
  const [payload, setPayload] = useState<MatricesLatestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freezeMapRef = useRef<Map<string, number>>(new Map());
  const prevValuesRef = useRef<Map<string, number>>(new Map());
  const [freezeVersion, setFreezeVersion] = useState(0);
  const [previewSet, setPreviewSet] = useState<Set<string>>(new Set());
  const { data: settings } = useSettings();

  const badgeFromRoute = useMemo(() => {
    const raw = params?.badge;
    return raw ? String(raw) : undefined;
  }, [params]);

  const fetchLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const badge = (badgeProp ?? badgeFromRoute ?? getBrowserBadge() ?? "").trim();
      if (!badge) throw new Error("badge_required");
      const res = await fetch(`/api/${encodeURIComponent(badge)}/matrices/latest`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const json = (await res.json()) as MatricesLatestResponse;
      setPayload(json);
      if (!json?.ok && !json?.error) {
        setError("Latest matrices payload is not ok");
      }
      if (json?.error) {
        setError(json.error);
      }
    } catch (err: any) {
      console.error("[matrices] latest fetch failed", err);
      setPayload(null);
      setError(String(err?.message ?? err ?? "Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [badgeProp, badgeFromRoute]);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  const autoRefreshEnabled = settings?.timing?.autoRefresh ?? true;
  const pollMs = useMemo(() => {
    const ms = Number(settings?.timing?.autoRefreshMs ?? DEFAULT_POLL_INTERVAL_MS);
    return Number.isFinite(ms) ? Math.max(1_000, ms) : DEFAULT_POLL_INTERVAL_MS;
  }, [settings?.timing?.autoRefreshMs]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const id = setInterval(fetchLatest, pollMs);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, pollMs, fetchLatest]);

  useEffect(() => {
    if (!payload?.ok) return;
    const quoteSym = toUpper(payload.quote ?? "USDT");
    const rawCoins = Array.isArray(payload.coins)
      ? payload.coins.map(toUpper)
      : [];
    const coins = Array.from(new Set<string>([quoteSym, ...rawCoins]));

    const metricMaps: Array<[string, MatrixValues | undefined]> = [
      ["benchmark", payload.matrices?.benchmark?.values],
      ["delta", payload.matrices?.delta?.values],
      ["pct24h", payload.matrices?.pct24h?.values],
      ["id_pct", payload.matrices?.id_pct?.values],
      ["pct_drv", payload.matrices?.pct_drv?.values],
      ["pct_ref", payload.matrices?.pct_ref?.values],
      ["ref", payload.matrices?.ref?.values],
      ["pct_snap", payload.matrices?.pct_snap?.values],
      ["snap", payload.matrices?.snap?.values],
      ["pct_traded", payload.matrices?.pct_traded?.values],
      ["traded", payload.matrices?.traded?.values],
    ];

    const nextFreeze = new Map(freezeMapRef.current);
    const nextPrev = new Map(prevValuesRef.current);
    const metricsPresent = new Set(
      metricMaps.filter(([, v]) => v).map(([m]) => m)
    );

    for (const key of Array.from(nextFreeze.keys())) {
      const [metric, base, quote] = key.split("|");
      if (
        !metricsPresent.has(metric) ||
        !coins.includes(base) ||
        !coins.includes(quote)
      ) {
        nextFreeze.delete(key);
        nextPrev.delete(key);
      }
    }

    for (const [metric, values] of metricMaps) {
      if (!values) continue;
      for (const base of coins) {
        for (const quote of coins) {
          if (base === quote) continue;
          const key = `${metric}|${base}|${quote}`;
          const val = getMatrixValue(values, base, quote);
          if (val == null || !Number.isFinite(val)) {
            nextFreeze.delete(key);
            nextPrev.delete(key);
            continue;
          }
          const prev = nextPrev.get(key);
          if (
            prev != null &&
            Number.isFinite(prev) &&
            Math.abs(val - prev) <= FREEZE_DELTA_EPS
          ) {
            const streak = (nextFreeze.get(key) ?? 0) + 1;
            nextFreeze.set(key, streak);
          } else {
            nextFreeze.set(key, 0);
          }
          nextPrev.set(key, val);
        }
      }
    }

    freezeMapRef.current = nextFreeze;
    prevValuesRef.current = nextPrev;
    setFreezeVersion((v) => v + 1);
  }, [payload]);

  const freezeStageFor = useCallback(
    (metric: string, base: string, quote: string): FrozenStage | null => {
      const streak = freezeMapRef.current.get(`${metric}|${base}|${quote}`) ?? 0;
      if (streak >= 4) return "long";
      if (streak >= 2) return "mid";
      if (streak >= 1) return "recent";
      return null;
    },
    [freezeVersion]
  );

  const previousValueFor = useCallback(
    (metric: string, base: string, quote: string): number | null => {
      const key = `${metric}|${base}|${quote}`;
      const val = prevValuesRef.current.get(key);
      if (val == null) return null;
      const num = Number(val);
      return Number.isFinite(num) ? num : null;
    },
    [freezeVersion]
  );

  const rows = useMemo<UiMatrixRow[]>(() => {
    return buildMatrixRows({ payload, previewSet, freezeStageFor, previousValueFor });
  }, [payload, previewSet, freezeStageFor, previousValueFor]);

  const coins = useMemo<string[]>(() => {
    const quoteSym = toUpper(payload?.quote ?? "USDT");
    const raw = Array.isArray(payload?.coins) ? payload.coins.map(toUpper) : [];
    return Array.from(new Set<string>([quoteSym, ...raw]));
  }, [payload?.coins, payload?.quote]);
  const coinsKey = useMemo(() => coins.join("|"), [coins]);

  useEffect(() => {
    let active = true;
    if (!coins.length) {
      setPreviewSet(new Set());
      return () => {
        active = false;
      };
    }
    (async () => {
      try {
        const { set } = await loadPreviewSymbolSet(coins);
        if (!active) return;
        setPreviewSet(new Set(set));
      } catch {
        if (!active) return;
        setPreviewSet(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [coinsKey]);

  const quote = toUpper(payload?.quote ?? "USDT");
  const baseCoins = useMemo(
    () => coins.filter((c) => c !== quote),
    [coins, quote]
  );
  const benchmarkTs = payload?.matrices?.benchmark?.ts;
  const mood = useMemo(() => computeMood(rows), [rows]);
  const winners = useMemo(() => selectTop(rows, "winners"), [rows]);
  const losers = useMemo(() => selectTop(rows, "losers"), [rows]);
  const openingTs = payload?.meta?.openingTs ?? null;
  const cycleTs = benchmarkTs ?? payload?.ts ?? null;
  const snapTs = payload?.meta?.snapshotTs ?? payload?.ts ?? cycleTs ?? null;
  const tradeTs = payload?.meta?.tradeTs ?? null;
  const windowLabel = (payload?.window ?? "30m") as "15m" | "30m" | "1h";
  const windowMs = WINDOW_TO_MS[windowLabel] ?? WINDOW_TO_MS["30m"];
  const openingOrdinal = ordinalFromTimestamp(openingTs, windowMs);
  const cycleOrdinal = relativeOrdinal(cycleTs, openingTs, windowMs);
  const snapOrdinal = relativeOrdinal(snapTs, openingTs, windowMs);
  const tradeOrdinal = relativeOrdinal(tradeTs, openingTs, windowMs);

  const statusLabel = payload?.ok ? "operational" : "awaiting signal";
  const statusAccent = payload?.ok ? "#4ade80" : "#facc15";
  const statCards = [
    {
      label: "Pairs tracked",
      value: rows.length,
      hint: `${baseCoins.length} assets | quote ${quote}`,
    },
    {
      label: "Opening anchor",
      value: formatTimestamp(openingTs),
      hint: openingOrdinal != null ? `cycle #${openingOrdinal}` : "not stamped",
      accent: "#fbbf24",
    },
    {
      label: "Current cycle",
      value: formatTimestamp(cycleTs),
      hint: cycleOrdinal != null ? `Δ#${cycleOrdinal}` : "pending",
      accent: "#38bdf8",
    },
    {
      label: "Snap stamp",
      value: formatTimestamp(snapTs),
      hint: snapOrdinal != null ? `Δ#${snapOrdinal}` : "pending",
      accent: "#c084fc",
    },
    {
      label: "Trade stamp",
      value: formatTimestamp(tradeTs),
      hint: tradeOrdinal != null ? `Δ#${tradeOrdinal}` : "pending",
      accent: "#22c55e",
    },
    {
      label: "Mood regime",
      value: mood.label,
      hint: formatDecimal(mood.score, 7),
      accent: mood.accent,
    },
    {
      label: "Status",
      value: statusLabel,
      accent: statusAccent,
      hint: error ?? undefined,
    },
  ];

  const matrixConfigs = useMemo(
    () => {
      const m = payload?.matrices ?? {};
      return [
        { key: "benchmark", label: "Benchmark", values: m.benchmark?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
        { key: "delta", label: "Delta", values: m.delta?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
        { key: "pct24h", label: "24h %", values: m.pct24h?.values, isPercent: true, zeroFloor: ZERO_FLOOR_PERCENT },
        { key: "id_pct", label: "id_pct", values: m.id_pct?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
        { key: "pct_drv", label: "pct_drv", values: m.pct_drv?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
        { key: "pct_ref", label: "pct_ref", values: m.pct_ref?.values, isPercent: true, zeroFloor: ZERO_FLOOR_PERCENT },
        { key: "ref", label: "ref", values: m.ref?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
        { key: "pct_snap", label: "pct_snap", values: m.pct_snap?.values, isPercent: true, zeroFloor: ZERO_FLOOR_PERCENT },
        { key: "snap", label: "snap", values: m.snap?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
        { key: "pct_traded", label: "pct_traded", values: m.pct_traded?.values, isPercent: true, zeroFloor: ZERO_FLOOR_PERCENT },
        { key: "traded", label: "traded", values: m.traded?.values, isPercent: false, zeroFloor: ZERO_FLOOR_DECIMAL },
      ].filter((entry) => entry.values);
    },
    [payload?.matrices]
  );

  return (
    <div
      className="min-h-dvh bg-[#020618] text-slate-100"
      style={{
        backgroundImage:
          "radial-gradient(circle at 15% 20%, rgba(56,189,248,0.18), transparent 55%), radial-gradient(circle at 85% 25%, rgba(168,85,247,0.14), transparent 60%), linear-gradient(180deg, rgba(2,6,23,0.95), rgba(15,23,42,0.92))",
      }}
    >
      <main className="relative mx-auto flex min-h-dvh w-full max-w-[1700px] flex-col gap-8 px-4 py-10 lg:px-10">
        <header className="relative overflow-hidden rounded-3xl bg-slate-950/85 p-6 shadow-[0_60px_140px_-70px_rgba(8,47,73,0.75)] backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-900/60 px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-slate-400">
                matrix control
              </span>
              <h1 className="text-3xl font-semibold text-slate-50">
                Matrices Observatory
              </h1>
            </div>

            <div className="flex items-center gap-2 self-start">
              <a
                className="inline-flex items-center rounded-full border border-white/20 bg-slate-900/70 px-4 py-2 text-xs uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/40"
                href="/api/matrices/latest"
                rel="noreferrer"
                target="_blank"
              >
                API
              </a>
              <button
                className="inline-flex items-center rounded-full bg-emerald-500/80 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700/70 disabled:text-slate-400"
                disabled={loading}
                onClick={fetchLatest}
              >
                {loading ? "Fetching..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {statCards.map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-[11px] uppercase tracking-wide text-slate-400">
            {RING_LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-2">
                <i
                  className={item.square ? "h-2.5 w-2.5 rounded-sm" : "h-2.5 w-2.5 rounded-full"}
                  style={{
                    background: item.color,
                    boxShadow: `0 0 10px ${withAlpha(item.color, 0.55)}`,
                  }}
                />
                {item.label}
              </span>
            ))}
            {error && (
              <span className="rounded-full border border-rose-500/50 px-3 py-1 text-rose-300">
                error: {error}
              </span>
            )}
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-2">
          {matrixConfigs.map((entry) => (
            <MatrixGridTable
              key={entry.key}
              title={entry.label}
              subtitle={`metric ${entry.key}`}
              metric={entry.key}
              coins={coins}
              values={entry.values}
              isPercent={entry.isPercent}
              zeroFloor={entry.zeroFloor}
              freezeStageFor={freezeStageFor}
              symbols={payload?.symbols}
              previewSet={previewSet}
              previousValueFor={previousValueFor}
              idPctValues={payload?.matrices?.id_pct?.values}
            />
          ))}
        </section>

        <section className="grid gap-6">
          <MoodAuxPanel
            snapshot={mood}
            winners={winners}
            losers={losers}
            lastUpdated={benchmarkTs}
            totalRows={rows.length}
          />
        </section>

        <section className="grid">
          <div className="rounded-[28px] bg-slate-950/70 p-4 shadow-[0_45px_110px_-60px_rgba(8,47,73,0.75)]">
            <MooAuxCard autoRefreshMs={60_000} className="w-full" />
          </div>
        </section>
      </main>
    </div>
  );
}
