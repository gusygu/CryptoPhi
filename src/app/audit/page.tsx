// src/app/audit/page.tsx
import { requireUserSession } from "@/app/(server)/auth/session";
import UserAuditClient from "@/components/audit/UserAuditClient";
import StrAuxAuditLink from "./StrAuxAuditLink";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TRACKS = [
  {
    key: "system",
    title: "System integrity",
    subtitle: "Host, uptime, env, clocks, and vitals - are we running cleanly?",
    bullets: [
      "Backend/web availability and recent deploy stamp",
      "Host clocks and drift checks",
      "Env completeness (non-sensitive flags only)",
      "Koyeb/worker health summaries",
    ],
  },
  {
    key: "user",
    title: "User data consistency",
    subtitle: "Your sessions, wallets, invites, and matrices alignment.",
    bullets: [
      "Sessions, invites, profile completeness",
      "Wallet presence vs recent usage",
      "Runtime cycles and identifiers (per user)",
      "API keys registered vs active (non-secret status only)",
    ],
  },
  {
    key: "dynamics",
    title: "Dynamics & sampling coherence",
    subtitle: "STR-AUX cycles, matrices freshness, sampler status.",
    bullets: [
      "Sampler cycles (warm vs stalled)",
      "Matrix shape checks and freshness",
      "Missing rows / delayed snapshots",
      "Recommended actions (refresh, warm-up, rebuild)",
    ],
  },
] as const;

export default async function AuditPage() {
  await requireUserSession();

  return (
    <main className="px-4 py-8 text-sm text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-2xl shadow-emerald-950/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">Audit ú User scope</p>
              <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Integrity & coherence</h1>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Three lenses: system integrity, your data consistency, and dynamics/sampling coherence. Checks are tied to
                your session and avoid exposing sensitive details.
              </p>
            </div>
            <div className="self-center">
              <StrAuxAuditLink />
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TRACKS.map((track) => (
            <article key={track.key} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">{track.title}</h2>
                <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                  {track.key}
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{track.subtitle}</p>
              <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
                {track.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/40 p-5 shadow-lg shadow-emerald-950/10">
          <div className="border-b border-zinc-900/60 pb-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">User audit trail</p>
            <p className="text-xs text-zinc-400">
              Cycle probes, sampler coherence, and per-user checks pulled from your session context.
            </p>
          </div>
          <div className="pt-5">
            <UserAuditClient />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Auth & session recap</h3>
            <p className="mt-2 text-xs text-zinc-400">
              Last sign-in, session age, invite state (sent / consumed / expired), and cookie host sanity.
            </p>
            <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
              <li>- Last login and last session refresh</li>
              <li>- Invite: status, timestamps (read-only email)</li>
              <li>- Host check: invite host vs current host</li>
            </ul>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Settings & wallets lint</h3>
            <p className="mt-2 text-xs text-zinc-400">
              Quick lint for your universe, timing, and wallet completeness.
            </p>
            <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
              <li>- Coin universe count (USDT enforced) and timing cadence</li>
              <li>- Sampler warm vs cold flag; latest matrices timestamp</li>
              <li>- Wallet hints: missing, invalid network/address length, duplicates</li>
            </ul>
          </article>
        </section>

        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-100">
          <p className="font-semibold">Data export snapshot</p>
          <p className="mt-1 text-emerald-200/90">
            Latest matrices ts, STR-AUX sampler age, moo-aux freshness. Use this to judge whether your view is current;
            refresh or wait for warm-up if stale.
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-900/70 bg-zinc-950/60 p-4 text-xs text-zinc-500">
          <p>
            Need broader system signals or user-wide reports? Admins can use the admin audit dashboard, which adds fleet
            vitals, noise leaderboards, and repair actions. Your view keeps to your data only.
          </p>
        </section>
      </div>
    </main>
  );
}
