import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { getEffectiveSettings } from "@/lib/settings/server";
import { withDbContext } from "@/core/db/pool_server";
import { computeFromDbAndLive } from "@/core/maths/math";
import { liveFromSources } from "@/core/features/matrices/liveFromSources";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const paramsMaybe = (context as any)?.params;
  const params =
    paramsMaybe && typeof paramsMaybe.then === "function" ? await paramsMaybe : paramsMaybe;
  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = resolved.badge;
  const session = resolved.session;

  try {
    const data = await withDbContext(
      {
        userId: session.userId,
        sessionId: badge,
        isAdmin: session.isAdmin,
        path: req.nextUrl.pathname,
        badgeParam: params?.badge ?? null,
        resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
      },
      async (client) => {
        const effective = await getEffectiveSettings({ userId: session.userId, badge, client });
        const coins = effective.coinUniverse.slice(0, 6);
        let sample: any = null;
        try {
          const live = await liveFromSources(coins).catch(() => null);
          if (live) {
            const derived = await computeFromDbAndLive({
              coins: live.coins,
              nowTs: live.matrices.benchmark.ts,
              liveBenchmark: [[]],
            }).catch(() => null);
            sample = {
              coins: live.coins,
              benchmarkTs: live.matrices.benchmark.ts,
              derived: !!derived,
            };
          }
        } catch {
          /* ignore */
        }
        return { effective, sample };
      },
    );
    return NextResponse.json(
      {
        ok: true,
        badge,
        userId: session.userId,
        resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
        effectiveSettings: data.effective,
        sample: data.sample,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err), badge, userId: session.userId },
      { status: 500 },
    );
  }
}
