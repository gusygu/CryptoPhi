// src/app/audit/page.tsx
import { requireUserSession } from "@/app/(server)/auth/session";
import UserAuditClient from "@/components/audit/UserAuditClient";
import AdminAuditClient from "@/components/audit/AdminAuditClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HIGHLIGHTS = [
  {
    title: "Cycle heartbeat",
    description: "Per-cycle summaries, status pills, and payload tails for every poller pass.",
  },
  {
    title: "STR-aux sampling",
    description: "Rolling notebook of anomaly probes so drift, benchmark tension, and bin stress stay visible.",
  },
  {
    title: "Mini-letters",
    description: "Users can nudge ops with reports or suggestions; admins reply from the same queue.",
  },
  {
    title: "Ops vitals",
    description: "Admin-only deck with vitals snapshots, noisy users, error queues, and action log.",
  },
] as const;

export default async function AuditPage() {
  const session = await requireUserSession();
  const isAdminOrDev = Boolean(session.isAdmin);

  return (
    <main className="px-4 py-8 text-sm text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-6 shadow-2xl shadow-emerald-950/10">
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">Observability</p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Audit trail & vitals</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            A single bench for cycle journaling, STR-aux sampling, and the letters flowing between users and ops.
            Inspired by the original panel but layered with the new audit mini-features.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHTS.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4"
            >
              <h2 className="text-sm font-semibold text-zinc-100">{feature.title}</h2>
              <p className="mt-2 text-xs text-zinc-500">{feature.description}</p>
            </article>
          ))}
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950/40 p-5">
            <div className="border-b border-zinc-900/60 pb-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">User audit trail</p>
              <p className="text-xs text-zinc-400">
                Cycles, sampling probes, and mini-letters tied to the signed-in session.
              </p>
            </div>
            <div className="pt-5">
              <UserAuditClient />
            </div>
          </div>

          {isAdminOrDev ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/40 p-5">
              <div className="border-b border-zinc-900/60 pb-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Admin oversight</p>
                <p className="text-xs text-zinc-400">
                  Extended grid with vitals snapshots, noise leaderboard, and recent admin actions.
                </p>
              </div>
              <div className="pt-5">
                <AdminAuditClient />
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
