// components/features/matrices/colors.ts
export type FrozenStage = "recent" | "mid" | "long";

const NEUTRAL = "#020617"; // slate-950-ish
const MUTED = "#0f172a"; // slate-900-ish
const NEUTRAL_TEXT = "#e2e8f0";

// Green & red scales (light -> dark; darker => farther from zero)
const POSITIVE_SHADES = [
  "#bbf7d0",
  "#86efac",
  "#4ade80",
  "#22c55e",
  "#16a34a",
  "#15803d",
];

const NEGATIVE_SHADES = [
  "#fecdd3",
  "#fda4af",
  "#fb7185",
  "#f43f5e",
  "#e11d48",
  "#991b1b",
];

// Blue/orange scales used for benchmark & moo deltas
const BENCHMARK_UP_SHADES = ["#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];
const BENCHMARK_DOWN_SHADES = ["#fed7aa", "#fdba74", "#fb923c", "#f97316", "#c2410c"];

// Purple for freezes/unchanged between cycles
const FROZEN_RECENT = "#d8b4fe"; // light purple (first cycles)
const FROZEN_MID = "#a855f7";    // medium purple (2-3 cycles)
const FROZEN_DEEP = "#4c1d95";   // darker purple (> 3 cycles)

// Amber for near-zero values
const AMBER_NOISE = "#facc15";

const AMBER_THRESHOLD = 1e-7;
const GRADIENT_RATIO_MAX = 1e6;

/** Backwards-compatible color aliases (legacy imports still expect these names). */
export const COLOR_POSITIVE_SHADES = POSITIVE_SHADES;
export const COLOR_NEGATIVE_SHADES = NEGATIVE_SHADES;
export const COLOR_AMBER = AMBER_NOISE;
export const COLOR_MUTED = MUTED;
export const COLOR_FROZEN = FROZEN_DEEP;
export const NULL_SENSITIVITY = 1e-9;

export const FROZEN_STAGE_COLORS: Record<FrozenStage, string> = {
  recent: FROZEN_RECENT,
  mid: FROZEN_MID,
  long: FROZEN_DEEP,
};

export function withAlpha(colorInput: string | null | undefined, alpha: number): string {
  // Default if caller sends null/undefined
  const color = colorInput ?? "#0f172a";
  const clamped = Math.min(1, Math.max(0, alpha));

  // Already rgba: just replace alpha
  if (color.startsWith("rgba")) {
    return color.replace(/rgba\(([^)]+)\)/, (_match, inner) => {
      const parts = inner.split(",").map((part) => part.trim());
      const [r, g, b] = parts;
      return `rgba(${r}, ${g}, ${b}, ${clamped})`;
    });
  }

  // rgb() -> rgba()
  if (color.startsWith("rgb")) {
    return color.replace(/rgb\(([^)]+)\)/, (_match, inner) => `rgba(${inner}, ${clamped})`);
  }

  // Non-hex / non-rgb (e.g. "transparent", "inherit", etc): pass through
  if (!color.startsWith("#")) return color;

  // Hex -> rgba
  const hex = color.slice(1);
  const normalized = hex.length === 3 ? hex.split("").map((h) => h + h).join("") : hex;
  const int = parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;

  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export type ColorForChangeOptions = {
  frozenStage?: FrozenStage | null;
  /**
   * "Near-zero" threshold -> amber.
   * We clamp to at least 1e-7 to highlight tiny moves.
   * For percentages (pct24h / pct_ref) you can pass e.g. 1e-7 (0.0000001).
   */
  zeroFloor?: number;
  /**
   * Optional separate epsilon (normally you don't need to override this).
   */
  epsilon?: number;
};

const paletteIndexFromMagnitude = (magnitude: number, floor: number, paletteLength: number) => {
  const safeFloor = Math.max(floor, 1e-12);
  const ratio = magnitude / safeFloor;
  // Normalize log-scale ratio into palette slots so small changes still move the color
  const normalized = Math.min(1, Math.log10(Math.max(1, ratio)) / Math.log10(GRADIENT_RATIO_MAX));
  const idx = Math.round(normalized * Math.max(0, paletteLength - 1));
  return Math.max(0, Math.min(paletteLength - 1, idx));
};

/**
 * Maps a signed value to a background color:
 *  - frozen -> purple
 *  - |value| <= zeroFloor -> amber (almost noise)
 *  - > 0 -> green scale
 *  - < 0 -> red scale
 *
 * This is intentionally **independent of text color**; numbers should be white.
 */
export function colorForChange(value: number | null, opts: ColorForChangeOptions = {}): string {
  const { frozenStage, zeroFloor, epsilon } = opts;

  // 1) Frozen wins regardless of sign
  if (frozenStage) {
    return FROZEN_STAGE_COLORS[frozenStage] ?? FROZEN_DEEP;
  }

  if (value == null || !Number.isFinite(value)) {
    return MUTED;
  }

  const v = Number(value);
  const magnitude = Math.abs(v);

  const floor = zeroFloor ?? 1e-8; // decimal/percent sensitivity
  const eps = epsilon ?? floor;
  const amberThreshold = Math.max(AMBER_THRESHOLD, eps);

  // 2) Near-zero -> amber
  if (magnitude <= amberThreshold) {
    return AMBER_NOISE;
  }

  const positive = v > 0;
  const palette = positive ? POSITIVE_SHADES : NEGATIVE_SHADES;
  const index = paletteIndexFromMagnitude(magnitude, floor, palette.length);

  return palette[index] ?? (positive ? POSITIVE_SHADES[0]! : NEGATIVE_SHADES[0]!);
}

type DeltaColorOptions = {
  frozenStage?: FrozenStage | null;
  zeroFloor?: number;
  epsilon?: number;
};

type BenchmarkColorOptions = DeltaColorOptions & {
  idPct?: number | null;
  prevIdPct?: number | null;
  idFrozenStage?: FrozenStage | null;
};

const detectSignFlip = (
  prevValue: number | null | undefined,
  nextValue: number | null | undefined
): "minusToPlus" | "plusToMinus" | null => {
  if (prevValue == null || nextValue == null) return null;
  if (!Number.isFinite(prevValue) || !Number.isFinite(nextValue)) return null;
  const prevSign = Math.sign(prevValue);
  const nextSign = Math.sign(nextValue);
  if (prevSign < 0 && nextSign > 0) return "minusToPlus";
  if (prevSign > 0 && nextSign < 0) return "plusToMinus";
  return null;
};

export function colorForBenchmarkDelta(
  value: number | null,
  prevValue: number | null,
  opts: BenchmarkColorOptions = {}
): string {
  const { frozenStage, zeroFloor, epsilon, idPct, prevIdPct, idFrozenStage } = opts;
  const stage = idFrozenStage ?? frozenStage;
  if (stage) return FROZEN_STAGE_COLORS[stage] ?? FROZEN_DEEP;
  if (value == null || !Number.isFinite(value)) return MUTED;
  const prev = Number(prevValue);
  if (!Number.isFinite(prev)) return MUTED;

  const delta = Number(value) - prev;
  const magnitude = Math.abs(delta);
  const floor = zeroFloor ?? 1e-8;
  const eps = epsilon ?? floor;
  const amberThreshold = Math.max(AMBER_THRESHOLD, eps);

  if (magnitude <= amberThreshold) return AMBER_NOISE;

  const signFlip = detectSignFlip(prevIdPct, idPct);
  if (signFlip) {
    const palette = signFlip === "minusToPlus" ? BENCHMARK_UP_SHADES : BENCHMARK_DOWN_SHADES;
    const idx = paletteIndexFromMagnitude(Math.abs(idPct ?? 0), floor, palette.length);
    return palette[idx] ?? palette[0]!;
  }

  const palette = delta >= 0 ? BENCHMARK_UP_SHADES : BENCHMARK_DOWN_SHADES;
  const index = paletteIndexFromMagnitude(magnitude, floor, palette.length);
  return palette[index] ?? palette[0]!;
}

export function colorForMooDelta(
  value: number | null,
  prevValue: number | null,
  opts: DeltaColorOptions = {}
): string {
  const { frozenStage, zeroFloor, epsilon } = opts;
  if (frozenStage) return FROZEN_STAGE_COLORS[frozenStage] ?? FROZEN_DEEP;
  if (value == null || !Number.isFinite(value)) return MUTED;
  const prev = Number(prevValue);
  if (!Number.isFinite(prev)) return MUTED;

  const delta = Number(value) - prev;
  const magnitude = Math.abs(delta);
  const floor = zeroFloor ?? 1e-8;
  const eps = epsilon ?? floor;
  const amberThreshold = Math.max(AMBER_THRESHOLD, eps);
  if (magnitude <= amberThreshold) return AMBER_NOISE;

  const palette = delta >= 0 ? BENCHMARK_UP_SHADES : BENCHMARK_DOWN_SHADES;
  const index = paletteIndexFromMagnitude(magnitude, floor, palette.length);
  return palette[index] ?? palette[0]!;
}

// Exported for any code that wants the raw palettes:
export const MATRICES_COLORS = {
  NEUTRAL,
  MUTED,
  NEUTRAL_TEXT,
  POSITIVE_SHADES,
  NEGATIVE_SHADES,
  BENCHMARK_UP_SHADES,
  BENCHMARK_DOWN_SHADES,
  FROZEN_RECENT,
  FROZEN_MID,
  FROZEN_DEEP,
  AMBER_NOISE,
  COLOR_POSITIVE_SHADES,
  COLOR_NEGATIVE_SHADES,
  COLOR_AMBER,
  COLOR_MUTED,
  COLOR_FROZEN,
  FROZEN_STAGE_COLORS,
};
