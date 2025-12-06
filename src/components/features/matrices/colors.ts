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
const FROZEN_RECENT = "#d8b4fe";
const FROZEN_DEEP = "#7c3aed";

// Amber for near-zero values
const AMBER_NOISE = "#facc15";

/** Backwards-compatible color aliases (legacy imports still expect these names). */
export const COLOR_POSITIVE_SHADES = POSITIVE_SHADES;
export const COLOR_NEGATIVE_SHADES = NEGATIVE_SHADES;
export const COLOR_AMBER = AMBER_NOISE;
export const COLOR_MUTED = MUTED;
export const COLOR_FROZEN = FROZEN_DEEP;
export const NULL_SENSITIVITY = 1e-9;

export const FROZEN_STAGE_COLORS: Record<FrozenStage, string> = {
  recent: FROZEN_RECENT,
  mid: FROZEN_DEEP,
  long: "#5b21b6",
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
   * Defaults to 1e-9 for decimal-valued matrices.
   * For percentages (pct24h / pct_ref) you can pass e.g. 1e-7 (0.0000001).
   */
  zeroFloor?: number;
  /**
   * Optional separate epsilon (normally you don't need to override this).
   */
  epsilon?: number;
};

const tierFromRatio = (ratio: number) => {
  let tier = 0;
  if (ratio > 10) tier = 1;
  if (ratio > 100) tier = 2;
  if (ratio > 1_000) tier = 3;
  if (ratio > 10_000) tier = 4;
  return tier;
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

  const floor = zeroFloor ?? 1e-9; // decimal sensitivity 1e-9
  const eps = epsilon ?? floor;

  // 2) Near-zero -> amber
  if (magnitude <= eps) {
    return AMBER_NOISE;
  }

  // 3) Pick a tier index based on how many orders of magnitude we are above floor
  const ratio = magnitude / floor;
  const tier = tierFromRatio(ratio);

  const positive = v > 0;
  const palette = positive ? POSITIVE_SHADES : NEGATIVE_SHADES;
  const index = Math.min(palette.length - 1, Math.max(0, tier));

  return palette[index] ?? (positive ? POSITIVE_SHADES[0]! : NEGATIVE_SHADES[0]!);
}

type DeltaColorOptions = {
  frozenStage?: FrozenStage | null;
  zeroFloor?: number;
  epsilon?: number;
};

export function colorForBenchmarkDelta(
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
  const floor = zeroFloor ?? 1e-9;
  const eps = epsilon ?? floor;
  if (magnitude <= eps) return FROZEN_RECENT;

  const ratio = magnitude / floor;
  const tier = tierFromRatio(ratio);

  const palette = delta >= 0 ? BENCHMARK_UP_SHADES : BENCHMARK_DOWN_SHADES;
  const index = Math.min(palette.length - 1, Math.max(0, tier));
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
  const floor = zeroFloor ?? 1e-9;
  const eps = epsilon ?? floor;
  if (magnitude <= eps) return FROZEN_RECENT;

  const ratio = magnitude / floor;
  const tier = tierFromRatio(ratio);

  const palette = delta >= 0 ? BENCHMARK_UP_SHADES : BENCHMARK_DOWN_SHADES;
  const index = Math.min(palette.length - 1, Math.max(0, tier));
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
  FROZEN_DEEP,
  AMBER_NOISE,
  COLOR_POSITIVE_SHADES,
  COLOR_NEGATIVE_SHADES,
  COLOR_AMBER,
  COLOR_MUTED,
  COLOR_FROZEN,
  FROZEN_STAGE_COLORS,
};
