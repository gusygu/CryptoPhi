/**
 * ArbitrageDashboard - client-side console to queue sequential arbitrage operations.
 * This is UI-only; wire the confirm handler to real trade executors + auth when ready.
 */
"use client";

import React, { useMemo, useState, useEffect } from "react";

type Cycle = {
  id: string;
  leg: string;
  spreadBps: number;
  estPnl: number;
  status: "ready" | "held" | "stale";
};

type NoteBook = Record<string, string>;

const COIN_POOL = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOT", "MATIC", "AVAX", "DOGE"];
const CONFIG_WINDOW_MS = 10 * 60 * 1000; // keep config warm for 10 minutes

export default function ArbitrageDashboard() {
  const [sequence, setSequence] = useState<string[]>(COIN_POOL.slice(0, 3));
  const [current, setCurrent] = useState<string>(COIN_POOL[0]);
  const [initialUsdt, setInitialUsdt] = useState<number>(1000);
  const [imprint, setImprint] = useState<NoteBook>({});
  const [luggage, setLuggage] = useState<NoteBook>({});
  const [configExpiresAt, setConfigExpiresAt] = useState<number>(Date.now() + CONFIG_WINDOW_MS);
  const [message, setMessage] = useState<string>("");

  const cycles: Cycle[] = useMemo(
    () => [
      { id: "ARB-1", leg: "USDT → BTC → ETH → USDT", spreadBps: 38, estPnl: 12.4, status: "ready" },
      { id: "ARB-2", leg: "USDT → SOL → BTC → USDT", spreadBps: 22, estPnl: 6.8, status: "held" },
      { id: "ARB-3", leg: "USDT → AVAX → ETH → USDT", spreadBps: 14, estPnl: 3.9, status: "stale" },
    ],
    []
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() > configExpiresAt) {
        setMessage("Config expired. Confirm again to re-arm the sequence.");
      }
    }, 1_000);
    return () => window.clearInterval(id);
  }, [configExpiresAt]);

  const onSelectSymbol = (sym: string) => {
    setCurrent(sym);
    setSequence((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
  };

  const onConfirm = () => {
    const nextExpiry = Date.now() + CONFIG_WINDOW_MS;
    setConfigExpiresAt(nextExpiry);
    setMessage(
      `Queued ${sequence.length} legs starting from ${initialUsdt.toFixed(
        2
      )} USDT. Config holds until ${new Date(nextExpiry).toLocaleTimeString()}.`
    );
    // TODO: wire into Binance-authenticated executor once credentials are available.
  };

  const currentImprint = imprint[current] ?? "";
  const currentLuggage = luggage[current] ?? "";
  const expiryCountdown = Math.max(0, configExpiresAt - Date.now());

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-amber-300">Arbitrage Console</p>
          <h1 className="text-2xl font-semibold text-emerald-100">Sequence builder</h1>
          <p className="mt-1 text-sm text-slate-400">
            Prepare a multi-leg cycle, attach imprint + luggage per symbol, then confirm to fire.
            This UI keeps the configuration warm for a short window; replace the confirm handler
            with your authenticated Binance executor when ready.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-right text-sm text-emerald-200 shadow-lg">
          <div className="font-semibold">Config TTL</div>
          <div>{(expiryCountdown / 1000).toFixed(0)}s</div>
          <div className="text-emerald-300/80 text-xs">
            {new Date(configExpiresAt).toLocaleTimeString()}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_50px_120px_-70px_rgba(8,47,73,0.85)]">
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-200">
                  Coin sequence
                </h3>
                <span className="text-[11px] text-slate-400">
                  Click a coin below to append / focus
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {sequence.map((sym, idx) => (
                  <button
                    key={sym}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold tracking-wide transition ${
                      sym === current
                        ? "border-emerald-400 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-300/60"
                    }`}
                    onClick={() => setCurrent(sym)}
                  >
                    {idx + 1}. {sym}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-200">
                Initial value
              </h3>
              <label className="mt-3 block text-xs uppercase tracking-wide text-slate-400">
                USDT to allocate
              </label>
              <input
                type="number"
                min={0}
                value={initialUsdt}
                onChange={(e) => setInitialUsdt(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-emerald-500/30 bg-slate-950/80 px-3 py-2 text-sm text-emerald-100 outline-none ring-emerald-400/50 focus:ring-2"
              />
              <p className="mt-2 text-xs text-slate-400">
                Stored for this sequence until expiration or a new confirm.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-200">
                  Imprint & luggage
                </h3>
                <span className="text-[11px] text-slate-400">For {current}</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">Imprint</label>
                  <textarea
                    value={currentImprint}
                    onChange={(e) =>
                      setImprint((prev) => ({ ...prev, [current]: e.target.value }))
                    }
                    rows={3}
                    className="mt-1 w-full resize-none rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400/50 focus:ring-2"
                    placeholder="Execution hints or guardrails"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">Luggage</label>
                  <textarea
                    value={currentLuggage}
                    onChange={(e) =>
                      setLuggage((prev) => ({ ...prev, [current]: e.target.value }))
                    }
                    rows={3}
                    className="mt-1 w-full resize-none rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400/50 focus:ring-2"
                    placeholder="State to carry across legs (notes, ids, limits)"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-200">
                Select coin
              </h3>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {COIN_POOL.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => onSelectSymbol(sym)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      sym === current
                        ? "border-emerald-400 bg-emerald-500/15 text-emerald-100 shadow-inner"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-400/60"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Click a symbol to edit imprint/luggage and attach to the sequence above.
              </p>
            </div>
          </div>
        </section>

        <aside className="flex h-full flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/80 p-4 shadow-[0_50px_120px_-70px_rgba(8,47,73,0.85)]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-200">
                Arbitrage cycles
              </h3>
              <p className="text-xs text-slate-400">PNL preview per configured leg loop</p>
            </div>
            <button
              onClick={onConfirm}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400"
            >
              Confirm sequence
            </button>
          </div>

          <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-slate-900/70">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.12em] text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">Cycle</th>
                  <th className="px-3 py-2 text-left">Leg</th>
                  <th className="px-3 py-2 text-right">Spread (bps)</th>
                  <th className="px-3 py-2 text-right">Est. PnL (USDT)</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-semibold text-slate-200">{c.id}</td>
                    <td className="px-3 py-2 text-slate-300">{c.leg}</td>
                    <td className="px-3 py-2 text-right text-amber-200">{c.spreadBps.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right text-emerald-200">
                      {c.estPnl.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          c.status === "ready"
                            ? "bg-emerald-500/20 text-emerald-100"
                            : c.status === "held"
                            ? "bg-amber-500/20 text-amber-100"
                            : "bg-slate-500/20 text-slate-200"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {message ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              {message}
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              Requires Binance trading authorization; current confirm only arms the client session.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
