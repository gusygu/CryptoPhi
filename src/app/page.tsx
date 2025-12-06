import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const quickLinks = [
  {
    href: "/matrices",
    title: "Matrices",
    blurb: "Benchmark • id_pct • pct24h • drv%",
  },
  {
    href: "/dynamics",
    title: "Dynamics",
    blurb: "Live id_pct, moo-aux, arbitrage edges",
  },
  {
    href: "/str-aux",
    title: "Str-Aux",
    blurb: "Sampling vectors, swaps, disruption",
  },
  {
    href: "/settings",
    title: "Settings",
    blurb: "Universe • timing • clusters • params",
  },
];

const newsBoard = [
  {
    title: "Dynamics repagination",
    detail:
      "New dual-line matrix pills, preview-aware rings, id_pct + moo alignment.",
  },
  {
    title: "Str-aux sampling",
    detail:
      "Scatter + accumulated histograms land on the STR dashboard for quicker drift sense.",
  },
  {
    title: "Snapshot hooks",
    detail:
      "Cin/Str metrics now pinned to last ON snapshot stamps across the client.",
  },
];

const nextCycle = [
  {
    title: "Preview gating",
    detail:
      "Apply preview availability to all contour rings and frozen-cycle states.",
  },
  {
    title: "Swap telemetry",
    detail:
      "Expose swap counters per session and last flip time directly in arb rows.",
  },
  {
    title: "Matrix hue audit",
    detail:
      "Benchmark shifts in blue/orange/purple; decimals and pct floors tightened.",
  },
];

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth");
  }

  return (
    <div
      className="relative min-h-dvh bg-[#04070f] text-slate-100"
      style={{
        backgroundImage:
          "radial-gradient(900px 720px at 14% 10%, rgba(56,189,248,0.15), transparent 55%), radial-gradient(680px 520px at 90% 14%, rgba(168,85,247,0.14), transparent 60%), linear-gradient(180deg, #03050b 0%, #050914 55%, #03050b 100%)",
      }}
    >
      <main className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-8 lg:px-8">
        <header className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 px-5 py-6 shadow-[0_55px_140px_-70px_rgba(56,189,248,0.35)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.35em] text-slate-300">
                cryptophi dynamics
              </p>
            </div>
            <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.28em] text-emerald-100">
              {user?.nickname || user?.email || "session"}
            </div>
          </div>
          <p className="max-w-3xl text-sm text-slate-300/80">
            Navigate matrices, dynamics, and auxiliary samplers from a single
            runway. Boards below keep current signals, expected next-cycle
            updates, and preview availability reminders in view.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group flex flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/70 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300/50 hover:bg-slate-900/80"
              >
                <span className="text-sm font-semibold text-slate-50">
                  {link.title}
                </span>
                <span className="text-xs text-slate-400">{link.blurb}</span>
                <span className="mt-auto text-[11px] uppercase tracking-[0.28em] text-emerald-200 opacity-0 transition group-hover:opacity-100">
                  open
                </span>
              </Link>
            ))}
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_45px_120px_-70px_rgba(168,85,247,0.45)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.32em] text-slate-200">
                News & updates
              </h2>
              <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                live
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {newsBoard.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/5 bg-gradient-to-r from-slate-900/80 via-slate-900/60 to-slate-900/40 px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
                >
                  <div className="text-[12px] uppercase tracking-[0.28em] text-emerald-200/80">
                    {item.title}
                  </div>
                  <div className="mt-1 text-sm text-slate-200">
                    {item.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_45px_120px_-70px_rgba(56,189,248,0.45)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.32em] text-slate-200">
                Expected next cycle
              </h2>
              <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                preview
              </span>
            </div>
            <ul className="mt-4 space-y-3">
              {nextCycle.map((item) => (
                <li
                  key={item.title}
                  className="flex flex-col gap-1 rounded-2xl border border-white/5 bg-slate-900/60 px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)]"
                >
                  <span className="text-[12px] uppercase tracking-[0.26em] text-cyan-200/80">
                    {item.title}
                  </span>
                  <span className="text-sm text-slate-200">{item.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_45px_120px_-70px_rgba(16,185,129,0.45)]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.32em] text-slate-200">
              Actions
            </h2>
            <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
              shortcuts
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/matrices"
              className="cp-card transition hover:border-emerald-300/60 hover:shadow-[0_16px_36px_rgba(16,185,129,0.25)]"
            >
              <div className="text-sm font-semibold text-slate-50">
                Open matrices
              </div>
              <div className="text-xs cp-subtle">
                Focus benchmark shifts and preview rings.
              </div>
            </Link>
            <Link
              href="/dynamics"
              className="cp-card transition hover:border-cyan-300/60 hover:shadow-[0_16px_36px_rgba(34,211,238,0.25)]"
            >
              <div className="text-sm font-semibold text-slate-50">
                Dynamics dashboard
              </div>
              <div className="text-xs cp-subtle">
                Dual-pill id_pct / moo and arbitrage table.
              </div>
            </Link>
            <Link
              href="/snapshot"
              className="cp-card transition hover:border-purple-300/60 hover:shadow-[0_16px_36px_rgba(168,85,247,0.25)]"
            >
              <div className="text-sm font-semibold text-slate-50">
                Last snapshot
              </div>
              <div className="text-xs cp-subtle">
                Inspect ON-stamped states for CIN & STR.
              </div>
            </Link>
          </div>
        </section>
      </main>

      <aside className="pointer-events-none fixed bottom-5 right-5 z-30 w-[320px] max-w-[92vw]">
        <div className="pointer-events-auto rounded-2xl border border-amber-400/40 bg-[#0f0a05]/90 px-4 py-3 shadow-[0_18px_48px_rgba(251,191,36,0.28)] backdrop-blur">
          <div className="text-[11px] uppercase tracking-[0.32em] text-amber-200">
            Sponsoring notice
          </div>
          <p className="mt-1 text-sm leading-relaxed text-amber-50">
            Sponsoring and Funding are still not available, for any communication
            regarding this matter please report to sponsoring@cryptophi.xyz
          </p>
        </div>
      </aside>
    </div>
  );
}
