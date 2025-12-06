import { redirect } from "next/navigation";
import { requireUserSession } from "@/app/(server)/auth/session";
import AdminAuditClient from "@/components/audit/AdminAuditClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TRACKS = [
  {
    key: "system",
    title: "System integrity & health",
    subtitle: "Backend uptime, worker/web split, env sanity, time drift, deploy/version drift.",
  },
  {
    key: "users",
    title: "User data consistency",
    subtitle: "Per-user sessions, invites, wallet coverage, runtime cycles, missing identifiers.",
  },
  {
    key: "dynamics",
    title: "Dynamics & sampling coherence",
    subtitle: "Sampler cycles, matrix freshness/shape, missing rows, stalled samplers.",
  },
] as const;

const OUTPUTS = [
  "Color-coded health and freshness signals",
  "Warnings with actionable fixes (redeploy, restart sampler, rebuild matrix)",
  "Links to logs/service states",
  "Leaderboards for noisy users or error-heavy flows",
] as const;

export default async function AdminAuditPage() {
  const session = await requireUserSession();
  if (!session.isAdmin) {
    redirect("/audit");
  }

  return (
    <main className="px-4 py-8 text-sm text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-emerald-500/20 bg-zinc-950/70 p-6 shadow-2xl shadow-emerald-900/25">
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">Audit · Admin scope</p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Ops control & signals</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-300">
            Fleet view across system integrity, user consistency, and dynamics/sampling coherence. Surfaces warnings,
            suggested actions, and repair affordances.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TRACKS.map((track) => (
            <article key={track.key} className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">{track.title}</h2>
                <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                  {track.key}
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{track.subtitle}</p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/50 p-5 shadow-lg shadow-emerald-950/15">
          <div className="border-b border-zinc-900/60 pb-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Outputs</p>
            <p className="text-xs text-zinc-400">
              Admin audit aggregates system/user/dynamics signals and pairs them with suggested remediations.
            </p>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {OUTPUTS.map((item) => (
              <li key={item} className="flex items-start gap-2 rounded-xl border border-zinc-800/60 bg-zinc-950/60 px-3 py-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                <span className="text-xs text-zinc-300">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/50 p-5 shadow-lg shadow-emerald-950/10">
          <div className="border-b border-zinc-900/60 pb-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Admin audit console</p>
            <p className="text-xs text-zinc-400">
              System vitals, user-wide consistency checks, noise leaderboards, and repair hooks (where available).
            </p>
          </div>
          <div className="pt-5">
            <AdminAuditClient />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Freshness dashboard</h3>
            <p className="mt-2 text-xs text-zinc-400">
              Age of latest matrices, STR-AUX sample age, moo-aux age, ingest queue lag, cache hit/miss (surface only non-sensitive aggregates).
            </p>
            <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
              <li>- Matrices timestamp, sampler age, moo-aux age</li>
              <li>- Queue lag / retry counts; sampler restart count</li>
              <li>- Error funnels: top 5 API 5xx by route</li>
            </ul>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">User consistency sweep</h3>
            <p className="mt-2 text-xs text-zinc-400">
              Accounts missing profile fields, stale invites, duplicated wallets, API keys marked active vs last-used timestamps.
            </p>
            <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
              <li>- Missing identifiers (owner/session stamps)</li>
              <li>- Wallet lint and duplicate detection</li>
              <li>- Invite status and age; API keys active vs last-used</li>
            </ul>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Actions & recommendations</h3>
            <p className="mt-2 text-xs text-zinc-400">
              Suggested remediations: redeploy, restart sampler, rebuild matrix, prune stale invites. Wire actions with confirmation flows.
            </p>
            <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
              <li>- Sampler warm-up/restart hooks</li>
              <li>- Matrix rebuild/refresh</li>
              <li>- Invite cleanup / cache flush</li>
            </ul>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Leaderboards & audit log</h3>
            <p className="mt-2 text-xs text-zinc-400">
              Noisy users (error-heavy), slowest routes, sampler load hotspots, and recent admin actions.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
