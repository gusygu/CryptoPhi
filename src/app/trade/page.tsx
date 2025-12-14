export const metadata = {
  title: "Trade | CryptoPi",
};

export default function TradePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-10 text-zinc-100">
      <header className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/70">Trading</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Execution console</h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          We&apos;re preparing the direct trading console. In the meantime, use the dashboards and matrices to monitor
          market structure and plan entries.
        </p>
      </header>

      <section className="rounded-3xl border border-emerald-500/10 bg-emerald-500/5 p-6 shadow-[0_0_24px_rgba(16,185,129,0.12)]">
        <h2 className="text-base font-semibold text-emerald-100">What to expect</h2>
        <ul className="mt-3 space-y-2 text-sm text-emerald-50/80">
          <li>- Pair-aware ticket tied to your badge session</li>
          <li>- Live STR/AUX snapshots to guide execution timing</li>
          <li>- Wallet + trade sync status surfaced inline</li>
        </ul>
        <p className="mt-4 text-xs text-emerald-200/80">
          If you need to trigger a trade now, contact the ops channel or use your exchange directly while we finalize
          the in-app flow.
        </p>
      </section>
    </main>
  );
}
