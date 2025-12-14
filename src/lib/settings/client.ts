// src/lib/settings/client.ts
"use client";

import { useEffect, useState } from "react";
import { migrateSettings, type AppSettings } from "@/lib/settings/schema";

function readSessionId(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  const grab = (name: string) =>
    parts.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  const canonical = grab("sessionId");
  const legacy = grab("appSessionId") || grab("app_session_id");
  if (canonical) return decodeURIComponent(canonical);
  if (legacy) {
    const decoded = decodeURIComponent(legacy);
    document.cookie = `sessionId=${encodeURIComponent(decoded)}; path=/; SameSite=Lax`;
    document.cookie = "appSessionId=; Max-Age=0; path=/; SameSite=Lax";
    document.cookie = "app_session_id=; Max-Age=0; path=/; SameSite=Lax";
    return decoded;
  }
  return null;
}

function readBadge(): string {
  const sid = readSessionId();
  return sid || "global";
}

function sessionHeaders(init?: HeadersInit): Headers {
  const h = new Headers(init ?? {});
  const sid = readSessionId();
  if (sid) {
    h.set("x-app-session", sid);
  }
  return h;
}

export async function fetchClientSettings(): Promise<AppSettings> {
  const badge = readBadge();
  const path = `/api/${encodeURIComponent(badge)}/settings`;
  const res = await fetch(path, { cache: "no-store", headers: sessionHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`GET /api/settings ${res.status}`);
  const payload = (await res.json()) as { settings?: unknown };
  if (!payload?.settings) throw new Error("GET /api/settings missing payload");
  return migrateSettings(payload.settings);
}

export function useSettings() {
  const [data, setData] = useState<AppSettings | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const s = await fetchClientSettings();
        if (alive) setData(s);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    // 🔁 React to provider broadcasts
    const onUpdated = () => load();
    window.addEventListener("app-settings:updated", onUpdated as EventListener);

    return () => {
      alive = false;
      window.removeEventListener("app-settings:updated", onUpdated as EventListener);
    };
  }, []);

  return { data, error, loading };
}

export function selectCoins(s?: AppSettings | null): string[] {
  const list = s?.coinUniverse ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list) {
    const u = String(c || "").trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  if (!seen.has("USDT")) out.push("USDT");
  return out;
}
