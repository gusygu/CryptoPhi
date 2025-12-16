// src/core/converters/Converter.client.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DynamicsSnapshot } from "@/core/converters/provider.types";

/* ----------------------------- Types ----------------------------- */

export type DynamicsRequest = {
  base: string;
  quote: string;
  coins: string[];
  candidates: string[];
  badge?: string | null;
  histLen?: number;
  bins?: number;
};

export type LegacyDomainVM = {
  Ca: string;
  Cb: string;
  coins: string[];
  wallets: Record<string, number>;
  matrix: {
    benchmark?: number[][];
    id_pct?: number[][];
    pct_drv?: number[][];
    mea?: number[][];
    ref?: number[][];
  };
  panels: {
    mea: { value: number; tier: string };
    cin: Record<string, any>;
    str: Record<string, any>;
  };
  rows: DynamicsSnapshot["arb"]["rows"];
  series?: DynamicsSnapshot["series"];
  snapshot?: DynamicsSnapshot;
};

type DomainVM = LegacyDomainVM;

type DynamicsResponse = { ok: boolean; snapshot?: DynamicsSnapshot; error?: string };

const ensureUpper = (s: string | undefined) => String(s ?? "").trim().toUpperCase();

const inferBadgeFromPath = () => {
  if (typeof window === "undefined") return null;
  const seg = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!seg || seg === "api") return null;
  return seg;
};

/* ----------------------------- Fetcher ----------------------------- */

export async function fetchDynamicsSnapshot(params: DynamicsRequest, signal?: AbortSignal): Promise<DynamicsSnapshot> {
  const base = ensureUpper(params.base);
  const quote = ensureUpper(params.quote);
  const coins = params.coins.map(ensureUpper);
  const candidates = params.candidates.map(ensureUpper);
  const badge = params.badge || inferBadgeFromPath() || "global";

  const url = new URL(`/api/${badge}/dynamics`, window.location.origin);
  url.searchParams.set("base", base);
  url.searchParams.set("quote", quote);
  if (coins.length) url.searchParams.set("coins", coins.join(","));
  if (candidates.length) url.searchParams.set("candidates", candidates.join(","));
  if (params.histLen != null) url.searchParams.set("histLen", String(params.histLen));
  if (params.bins != null) url.searchParams.set("bins", String(params.bins));
  url.searchParams.set("t", String(Date.now()));

  const res = await fetch(url.toString(), {
    cache: "no-store",
    signal,
    credentials: "include",
    headers: { "x-app-session": badge },
  });
  if (!res.ok) {
    const snippet = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => "");
    throw new Error(`/api/${badge}/dynamics HTTP ${res.status}: ${snippet}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    const snippet = await res
      .text()
      .then((t) => t.slice(0, 200))
      .catch(() => "");
    throw new Error(`Expected JSON from /api/${badge}/dynamics (ct=${ct || "unknown"}): ${snippet}`);
  }

  const payload = (await res.json()) as DynamicsResponse;
  if (!payload.ok || !payload.snapshot) throw new Error(payload.error ?? "dynamics snapshot error");
  return payload.snapshot;
}

/* ------------------------------ Hooks ------------------------------ */

export function useDynamicsSnapshot(params: DynamicsRequest) {
  const [snapshot, setSnapshot] = useState<DynamicsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const coinsKey = useMemo(() => params.coins.map(ensureUpper).join(","), [params.coins]);
  const candsKey = useMemo(() => params.candidates.map(ensureUpper).join(","), [params.candidates]);
  const base = useMemo(() => ensureUpper(params.base), [params.base]);
  const quote = useMemo(() => ensureUpper(params.quote), [params.quote]);
  const histKey = useMemo(() => String(params.histLen ?? ""), [params.histLen]);
  const binsKey = useMemo(() => String(params.bins ?? ""), [params.bins]);
  const badgeKey = useMemo(() => params.badge ?? "", [params.badge]);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  useEffect(() => {
    if (!base || !quote || !params.coins.length) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const snap = await fetchDynamicsSnapshot(
          {
            base,
            quote,
            coins: params.coins,
            candidates: params.candidates,
            badge: params.badge ?? undefined,
            histLen: params.histLen,
            bins: params.bins,
          },
          ac.signal
        );
        setSnapshot(snap);
      } catch (err: any) {
        if (!ac.signal.aborted) {
          setSnapshot(null);
          setError(err?.message ?? String(err));
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [base, quote, coinsKey, candsKey, histKey, binsKey, badgeKey, refreshToken]);

  return { snapshot, loading, error, refresh } as const;
}

export function useDomainVM(Ca: string, Cb: string, coins: string[], candidates: string[]) {
  const { snapshot, loading, error, refresh } = useDynamicsSnapshot({
    base: Ca,
    quote: Cb,
    coins,
    candidates,
  });

  const vm = useMemo<DomainVM | null>(() => (snapshot ? toLegacyVM(snapshot) : null), [snapshot]);

  return { vm, loading, error, refresh } as const;
}

/* ------------------------------ Mappers ------------------------------ */

export function fromDynamicsSnapshot(snapshot: DynamicsSnapshot): DomainVM {
  return {
    Ca: snapshot.base,
    Cb: snapshot.quote,
    coins: snapshot.coins,
    wallets: snapshot.wallets,
    matrix: {
      benchmark: snapshot.matrix.benchmark,
      id_pct: snapshot.matrix.id_pct,
      pct_drv: snapshot.matrix.pct_drv,
      mea: snapshot.matrix.mea,
      ref: snapshot.matrix.ref,
    },
    panels: {
      mea: snapshot.metrics.mea,
      cin: snapshot.metrics.cin,
      str: snapshot.metrics.str,
    },
    rows: snapshot.arb.rows,
    series: snapshot.series,
    snapshot,
  };
}

function toLegacyVM(snapshot: DynamicsSnapshot): DomainVM {
  return fromDynamicsSnapshot(snapshot);
}

export function toMatrix(vm: DomainVM | null) {
  const m = vm?.matrix ?? {};
  return {
    benchmark: m.benchmark ?? [],
    id_pct: m.id_pct ?? [],
    drv: m.pct_drv ?? [],
    mea: m.mea ?? [],
    ref: m.ref ?? [],
  };
}

export function toArbTableInput(vm: DomainVM | null) {
  return {
    rows: vm?.rows ?? [],
    wallets: vm?.wallets ?? {},
  };
}

export function toMetricsPanel(vm: DomainVM | null) {
  return {
    mea: {
      value: Number(vm?.panels?.mea?.value ?? 0),
      tier: String(vm?.panels?.mea?.tier ?? "-"),
    },
    cin: vm?.panels?.cin ?? {},
    str: vm?.panels?.str ?? {},
  };
}

/* ----------------------------- Helpers ----------------------------- */

export function cell(
  g: number[][] | undefined,
  coins: string[] | undefined,
  a: string | undefined,
  b: string | undefined
): number | undefined {
  if (!g || !coins || !a || !b) return undefined;
  const i = coins.indexOf(a);
  const j = coins.indexOf(b);
  if (i < 0 || j < 0) return undefined;
  return g[i]?.[j];
}
