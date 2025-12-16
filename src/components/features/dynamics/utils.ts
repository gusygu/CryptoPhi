// src/components/features/dynamics/utils.ts
export type ClassValue = string | false | null | undefined;

export function classNames(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

export type FormatNumberOptions = {
  precision?: number;
  minimumFractionDigits?: number;
  fallback?: string;
  sign?: "auto" | "always";
};

export function formatNumber(value: unknown, options: FormatNumberOptions = {}): string {
  const {
    precision = 4,
    minimumFractionDigits,
    fallback = "-",
    sign = "auto",
  } = options;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  const formatted = numeric.toLocaleString(undefined, {
    minimumFractionDigits: minimumFractionDigits ?? Math.min(precision, 2),
    maximumFractionDigits: precision,
  });

  if (sign === "always" && numeric > 0) {
    return `+${formatted}`;
  }

  return formatted;
}

export function formatPercent(value: unknown, options: FormatNumberOptions = {}): string {
  const formatted = formatNumber(value, { precision: 4, ...options });
  return formatted === options.fallback ? formatted : `${formatted}%`;
}

export async function safeJsonFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const snippet = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${snippet}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    const snippet = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => "");
    throw new Error(`Expected JSON for ${url} (ct=${ct || "unknown"}): ${snippet}`);
  }
  return (await res.json()) as T;
}

export function uniqueUpper(tokens: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens ?? []) {
    const token = String(raw ?? "").trim().toUpperCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
