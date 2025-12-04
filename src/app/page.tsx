import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * Minimal landing page
 * - No legacy diagnostics/widgets
 * - Quick links to core areas
 */
export default async function Page() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth");
  }

  return (
    <div className="min-h-dvh p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center gap-3">
          <h1 className="cp-h1">CryptoPi  Dynamics</h1>
          <div className="text-xs text-emerald-200 opacity-70">{user?.nickname || user?.email}</div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/matrices" className="cp-card hover:brightness-110 transition">
            <div className="text-sm font-medium">Matrices</div>
            <div className="text-xs cp-subtle">
              Benchmark ú id_pct ú %24h ú drv%
            </div>
          </Link>

          <Link href="/settings" className="cp-card hover:brightness-110 transition">
            <div className="text-sm font-medium">Settings</div>
            <div className="text-xs cp-subtle">
              Universe ú timing ú clusters ú params
            </div>
          </Link>
        </div>

        <p className="text-xs cp-subtle">
          Tip: you can wire the poller & autosave directly on the Matrices page;
          the root landing intentionally stays minimal while we refactor the server routes.
        </p>
      </div>
    </div>
  );
}
