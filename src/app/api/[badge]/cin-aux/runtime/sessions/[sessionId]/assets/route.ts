import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { withDbContext } from "@/core/db/pool_server";
import { setRequestContext } from "@/lib/server/request-context";
import { mapRuntimeSessionRow } from "@/core/features/cin-aux/runtimeQueries";

async function unwrapParams(context: any): Promise<{ badge?: string; sessionId?: string }> {
  return typeof context?.params?.then === "function" ? await context.params : context?.params ?? {};
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asString(value: unknown, fallback = "0"): string {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? value : String(value);
}

export async function GET(
  req: NextRequest,
  ctx: { params: { sessionId: string } } | { params: Promise<{ sessionId: string }> },
) {
  const { badge, sessionId: sessionIdRaw } = await unwrapParams(ctx);
  const resolved = await resolveBadgeRequestContext(req, { badge });
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const sessionId = /^\d+$/.test(String(sessionIdRaw ?? "")) ? Number(sessionIdRaw) : NaN;
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ session: null, assets: [] }, { status: 200 });
  }

  const badgeEffective = resolved.badge;
  const userId = resolved.session.userId;
  const resolvedFromSessionMap = (resolved.session as any)?.resolvedFromSessionMap ?? false;

  try {
    await setRequestContext({ userId, sessionId: badgeEffective });
    const payload = await withDbContext(
      {
        userId,
        sessionId: badgeEffective,
        isAdmin: resolved.session.isAdmin,
        path: req.nextUrl.pathname,
        badgeParam: badge ?? null,
        resolvedFromSessionMap,
      },
      async (client) => {
        try {
          const sessionRes = await client.query(
            `
              SELECT s.*, recon.cin_total_mtm_usdt, recon.ref_total_usdt, recon.delta_usdt, recon.delta_ratio
                FROM cin_aux.v_rt_session_summary s
                LEFT JOIN cin_aux.v_rt_session_recon recon
                  ON recon.session_id = s.session_id
               WHERE s.session_id = $1
            `,
            [sessionId],
          );
          const session = sessionRes.rows?.[0] ? mapRuntimeSessionRow(sessionRes.rows[0]) : null;

          const assetsRes = await client.query(
            `
              SELECT
                ap.*,
                (cu.base_asset IS NOT NULL) AS in_universe,
                ref.ref_usdt
              FROM cin_aux.v_rt_asset_pnl ap
              LEFT JOIN settings.coin_universe cu
                ON cu.enabled = TRUE
               AND cu.base_asset IS NOT NULL
               AND UPPER(cu.base_asset) = UPPER(ap.asset_id)
              LEFT JOIN cin_aux.rt_reference ref
                ON ref.session_id = ap.session_id
               AND UPPER(ref.asset_id) = UPPER(ap.asset_id)
              WHERE ap.session_id = $1
              ORDER BY ap.mtm_value_usdt DESC NULLS LAST, ap.asset_id ASC
            `,
            [sessionId],
          );

          const totalMtm = (assetsRes.rows ?? []).reduce(
            (acc: number, row: any) => acc + toNumber(row.mtm_value_usdt),
            0,
          );

          const assets = (assetsRes.rows ?? []).map((row: any) => {
            const mtmValue = toNumber(row.mtm_value_usdt);
            return {
              sessionId: Number(row.session_id),
              assetId: row.asset_id,
              openingPrincipal: asString(row.opening_principal ?? "0"),
              openingProfit: asString(row.opening_profit ?? "0"),
              principalUsdt: asString(row.principal_usdt ?? "0"),
              profitUsdt: asString(row.profit_usdt ?? "0"),
              lastMarkTs: row.last_mark_ts,
              priceUsdt: row.price_usdt != null ? asString(row.price_usdt) : null,
              bulkUsdt: asString(row.bulk_usdt ?? "0"),
              mtmValueUsdt: asString(row.mtm_value_usdt ?? "0"),
              weightInPortfolio:
                totalMtm > 0 && Number.isFinite(mtmValue) ? mtmValue / totalMtm : null,
              realizedPnlUsdt: row.realized_pnl_usdt != null ? asString(row.realized_pnl_usdt) : null,
              inUniverse: Boolean(row.in_universe),
              referenceUsdt: row.ref_usdt != null ? asString(row.ref_usdt) : null,
              accountUnits: row.account_units ?? null,
            };
          });

          return { session, assets };
        } catch {
          return { session: null, assets: [] };
        }
      },
    );
    return NextResponse.json(payload ?? { session: null, assets: [] });
  } catch {
    return NextResponse.json({ session: null, assets: [] });
  }
}
