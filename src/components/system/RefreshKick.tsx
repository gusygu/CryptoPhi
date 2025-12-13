"use client";

import { useEffect } from "react";

type Props = {
  badge: string | null | undefined;
  /** throttle window in ms to avoid hammering refresh */
  minIntervalMs?: number;
};

const readSessionId = (): string | null => {
  if (typeof document === "undefined") return null;
  const raw = document.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith("sessionId=")) return decodeURIComponent(p.slice("sessionId=".length));
  }
  return null;
};

/**
 * Lightweight client hook that triggers /api/{badge}/system/refresh once per tab
 * (throttled via localStorage) so the current user's matrices are ingested.
 */
export function RefreshKick({ badge, minIntervalMs = 60_000 }: Props) {
  useEffect(() => {
    const b = (badge ?? "").trim();
    if (!b) return;

    const sessionId = readSessionId();
    const refreshKey = `cp_refresh_${b}`;
    const openingKey = `cp_opening_${sessionId ?? b}`;
    const now = Date.now();
    const lastRefresh = Number(localStorage.getItem(refreshKey) || 0);
    const hasOpeningStamp = localStorage.getItem(openingKey) != null;
    const shouldRefresh = !(Number.isFinite(lastRefresh) && now - lastRefresh < minIntervalMs);
    const shouldOpening = !hasOpeningStamp;
    if (!shouldRefresh && !shouldOpening) return;

    const refreshController = new AbortController();
    const openingController = new AbortController();

    if (shouldOpening) {
      const openingUrl = `/api/${encodeURIComponent(b)}/system/opening`;
      const sid = sessionId || b;
      fetch(openingUrl, {
        method: "POST",
        keepalive: true,
        signal: openingController.signal,
        headers: sid ? { "x-app-session": sid } : undefined,
      }).catch(
        () => {
          /* non-blocking */
        }
      );
      localStorage.setItem(openingKey, String(now));
    }

    if (shouldRefresh) {
      const refreshUrl = `/api/${encodeURIComponent(b)}/system/refresh`;
      const sid = sessionId || b;
      fetch(refreshUrl, {
        method: "POST",
        keepalive: true,
        signal: refreshController.signal,
        headers: sid ? { "x-app-session": sid } : undefined,
      }).catch(
        () => {
          /* swallow errors; UI should still render */
        }
      );
      localStorage.setItem(refreshKey, String(now));
    }

    return () => {
      refreshController.abort();
      openingController.abort();
    };
  }, [badge, minIntervalMs]);

  return null;
}
