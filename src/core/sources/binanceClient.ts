// src/core/sources/binanceClient.ts
// Lightweight helper for Binance public REST calls used across the pipeline.

const DEFAULT_BASE = process.env.BINANCE_BASE_URL?.trim() || "https://api.binance.com";
const DEFAULT_TIMEOUT_MS = 8000;

function buildUrl(path: string, query?: Record<string, string | number | undefined>) {
  const url = path.startsWith("http") ? new URL(path) : new URL(path, DEFAULT_BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function fetchJson<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
  init?: RequestInit,
): Promise<T> {
  const url = buildUrl(path, query);

  // Abort if Binance is slow/unreachable to avoid wedging the API route.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
      ...init,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no-body>");
      throw new Error(`binance ${url.pathname} -> ${response.status} ${text}`);
    }

    return (await response.json()) as T;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`binance ${url.pathname} -> timeout after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
