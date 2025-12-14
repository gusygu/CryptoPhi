import { NextResponse, type NextRequest } from "next/server";
import { withDbContext } from "@/core/db/db_server";
import { fetchCoinUniverseEntries } from "@/lib/settings/coin-universe";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { resolveBadgeScope } from "@/lib/server/badge-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Timing model:
 *  - point = 5s (fixed)
 *  - cycle duration (sec) inferred by: 30 min / str_cycles_m30
 *  - windows (30m,1h,3h) cycles_per_window come from params:
 *      30m -> str_cycles_m30
 *      1h  -> str_cycles_h1
 *      3h  -> str_cycles_h3
 *    seconds per window derived from label.
 *
 * All primitives live in settings per your DDL:
 *   - user_space.v_params (str_cycles_m30, str_cycles_h1, str_cycles_h3, etc.)
 *   - settings.windows (labels like '30m','1h','3h')
 *   - user_space.v_coin_universe (enabled symbols resolved with per-user overrides)
 * See 02_settings.sql. 
 */

type TimingRow = {
  str_cycles_m30: number | null;
  str_cycles_h1: number | null;
  str_cycles_h3: number | null;
};

function windowSeconds(label: string): number {
  const l = label.toLowerCase();
  if (l === "30m" || l === "30min" || l === "30") return 30 * 60;
  if (l === "1h" || l === "60m") return 60 * 60;
  if (l === "3h") return 3 * 60 * 60;
  // fallback: parse like "15m", "4h", "2d" if needed
  const m = l.match(/^(\d+)([mhd])$/);
  if (!m) return 60; // default 1m
  const n = parseInt(m[1], 10);
  if (m[2] === "m") return n * 60;
  if (m[2] === "h") return n * 3600;
  if (m[2] === "d") return n * 86400;
  return 60;
}

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  try {
    const params =
      typeof (context as any)?.params?.then === "function"
        ? await (context as { params: Promise<{ badge?: string }> }).params
        : (context as { params: { badge?: string } }).params;
    const badgeScope = resolveBadgeScope(req, { badge: params?.badge ?? null });
    const badge = badgeScope.effectiveBadge;
    const resolved = await resolveBadgeRequestContext(req, { badge });
    if (!resolved.ok) {
      return NextResponse.json(resolved.body, { status: resolved.status });
    }
    const session = resolved.session;
    if (!badge) {
      return NextResponse.json({ ok: false, error: "missing_session_badge" }, { status: 401 });
    }

    const response = await withDbContext(
      { userId: session.userId, sessionId: badge, isAdmin: session.isAdmin, path: req.nextUrl.pathname, badgeParam: badgeScope.badgeParam },
      async (client) => {
        const entries = await fetchCoinUniverseEntries({ onlyEnabled: true }, client);
        const symbols = entries.map((entry) => entry.symbol);
        if (!symbols.length) {
          return NextResponse.json(
            { ok: false, error: "coin universe is empty" },
            { status: 400 }
          );
        }

        // 2) Params (singleton row) with cycles-per-window counts
        const par = await client.query<TimingRow>(
          `select str_cycles_m30, str_cycles_h1, str_cycles_h3 from user_space.v_params limit 1`
        );
        const P = par.rows[0] ?? { str_cycles_m30: 45, str_cycles_h1: 90, str_cycles_h3: 270 };

        // 3) Canonical window labels present (we'll try to pull the three primary ones if they exist)
        const wins = await client.query<{ window_label: string }>(
          `select window_label from settings.windows where window_label in ('30m','1h','3h') order by duration_ms`
        );
        const labels = wins.rows.length ? wins.rows.map(r => r.window_label) : ["30m", "1h", "3h"];

        // 4) Compute timing:
        //    - point = 5s (your model)
        //    - cycle_sec = (30 min) / str_cycles_m30
        const point_sec = 5;
        const s30 = windowSeconds("30m");
        const cycles_m30 = P.str_cycles_m30 ?? 45; // matches your defaults (30m / 40s = 45)
        const cycle_sec = Math.max(1, Math.floor(s30 / Math.max(1, cycles_m30))); // e.g., 1800/45 = 40

        const windows = labels.map(label => {
          const secs = windowSeconds(label);
          const cycles_per_window =
            label === "30m" ? (P.str_cycles_m30 ?? 45) :
            label === "1h"  ? (P.str_cycles_h1  ?? 90) :
            label === "3h"  ? (P.str_cycles_h3  ?? 270) :
            Math.max(1, Math.round(secs / cycle_sec));

          return {
            label,
            seconds: secs,
            cycles_per_window,
          };
        });

        return NextResponse.json({
          ok: true,
          ts: Date.now(),
          symbols,
          timing: {
            point_sec,          // 5
            cycle_sec,          // inferred (usually 40)
            windows,            // [{label:'30m', seconds:1800, cycles_per_window:45}, ...]
          },
        }, { headers: { "Cache-Control": "no-store" } });
      },
    );
    return response;

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
