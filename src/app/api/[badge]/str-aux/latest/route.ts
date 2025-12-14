// src/app/api/str-aux/latest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { saveCycleDocument } from "@/core/db/cycleDocuments";
import {
  buildStrAuxBins,
  splitSymbol,
  type CoinOut,
} from "../utils";
import {
  NO_STORE,
  parseBaseQuote,
  parseStrAuxQuery,
  prependToken,
} from "../request";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { getEffectiveSettings } from "@/lib/settings/server";
import { withDbContext } from "@/core/db/pool_server";

export const dynamic = "force-dynamic";

function buildSession(symbol: string, coin: CoinOut, appSessionId: string) {
  const { base, quote } = splitSymbol(symbol);
  const opening = coin.cards?.opening;
  const live = coin.cards?.live;

  return {
    app_session_id: appSessionId,
    pair_base: base,
    pair_quote: quote,
    window_key: coin.window,
    opening_stamp: false,
    opening_ts: coin.openingTs ?? null,
    opening_price: opening?.benchmark ?? null,
    price_min: coin.sessionStats?.priceMin ?? null,
    price_max: coin.sessionStats?.priceMax ?? null,
    bench_pct_min: coin.sessionStats?.benchPctMin ?? null,
    bench_pct_max: coin.sessionStats?.benchPctMax ?? null,
    swaps: coin.swaps ?? 0,
    shifts: coin.shifts ?? 0,
    gfm_anchor_price: coin.fm?.gfm_ref_price ?? null,
    gfm_calc_price_last: coin.fm?.gfm_calc_price ?? null,
    gfm_r_last: coin.fm?.gfm_price ?? null,
    ui_epoch: coin.meta?.uiEpoch ?? null,
    above_count: null,
    below_count: null,
    eps_shift_pct: null,
    k_cycles: null,
    last_price: live?.benchmark ?? null,
    last_update_ms: coin.lastUpdateTs ?? null,
    snap_prev: {
      benchmark: coin.streams?.benchmark?.prev ?? null,
      pct24h: coin.streams?.pct24h?.prev ?? null,
      pct_drv: coin.streams?.pct_drv?.prev ?? null,
    },
    snap_cur: {
      benchmark: coin.streams?.benchmark?.cur ?? null,
      pct24h: coin.streams?.pct24h?.cur ?? null,
      pct_drv: coin.streams?.pct_drv?.cur ?? null,
    },
    greatest_bench_abs: coin.streams?.benchmark?.greatest ?? null,
    greatest_drv_abs: coin.streams?.pct_drv?.greatest ?? null,
    greatest_pct24h_abs: coin.streams?.pct24h?.greatest ?? null,
    shift_stamp: false,
    gfm_delta_last: coin.gfmDelta?.absPct ?? null,
    bins: coin.hist ?? null,
  };
}

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const url = req.nextUrl;
  const paramsMaybe = (context as any)?.params;
  const params =
    paramsMaybe && typeof paramsMaybe.then === "function" ? await paramsMaybe : paramsMaybe;
  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = resolved.badge;
  const session = resolved.session;

  const query = parseStrAuxQuery(url, {
    defaultSessionId: badge,
    badge,
    headerSession: null,
    cookieSession: null,
  });
  const appSessionId = (badge || "").trim();
  if (!appSessionId) {
    return NextResponse.json({ ok: false, error: "missing_session" }, { status: 401, headers: NO_STORE });
  }
  query.appSessionId = appSessionId;
  const { pair } = parseBaseQuote(url);
  const tokens = prependToken(query.tokens, pair);

  const payload = await withDbContext(
    {
      userId: session.userId,
      sessionId: badge,
      isAdmin: session.isAdmin,
      path: req.nextUrl.pathname,
      badgeParam: params?.badge ?? null,
      resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
    },
    async (client) =>
      buildStrAuxBins({
        tokens,
        window: query.window,
        bins: query.bins,
        allowUnverified: query.allowUnverified,
        hideNoData: false,
        appSessionId,
        settingsOverride: await getEffectiveSettings({ userId: session.userId, badge, client }),
      }),
  );

  // Prefer explicit pair if it returned ok; otherwise pick the first ok symbol
  const selectionOrder = prependToken(payload.symbols, pair);
  const chosen = selectionOrder.find((sym) => payload.out[sym]?.ok) ?? payload.symbols.find((s) => payload.out[s]?.ok);

  if (!chosen) {
    const headers = new Headers(NO_STORE);
    headers.set("x-cycle-id", String(payload?.ts ?? Date.now()));
    return NextResponse.json(
      { ok: false, error: "no_symbol_available" },
      { headers }
    );
  }

  const coin = payload.out[chosen]!;
  const session = buildSession(chosen, coin, appSessionId);

  try {
    const cycleTs = Number(coin.lastUpdateTs ?? Date.now());
    await saveCycleDocument({
      domain: "str",
      appSessionId,
      cycleTs,
      payload: { ok: true, session, source: "computed" },
      notes: "api:str-aux/latest",
    });
  } catch (err) {
    console.warn("[str-aux] saveCycleDocument failed", err);
  }

  const headers = new Headers(NO_STORE);
  headers.set("x-cycle-id", String(payload?.ts ?? Date.now()));

  return NextResponse.json(
    { ok: true, session },
    { headers }
  );
}
