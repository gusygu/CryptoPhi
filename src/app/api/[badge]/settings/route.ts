// src/app/api/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAll, serializeSettingsCookie } from "@/lib/settings/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { withDbContext } from "@/core/db/pool_server";
import { upsertSessionCoinUniverse, upsertUserCoinUniverse } from "@/lib/settings/coin-universe";
import { adoptSessionRequestContext } from "@/lib/server/request-context";
import { resolveBadgeScope } from "@/lib/server/badge-scope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const badgeScope = resolveBadgeScope(req, { badge: params?.badge ?? null });
  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = (badgeScope.effectiveBadge || "").trim();
  const session = resolved.session;
  if (!badge) {
    return NextResponse.json({ ok: false, error: "missing_session" }, { status: 401 });
  }
  adoptSessionRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
  });

  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const settings = await getAll();
  const cookieName = `appSettings_${badge}`;
  const scope = req.nextUrl.searchParams.get("scope");

  if (scope === "poller") {
    return NextResponse.json({ poll: settings.poll }, { headers: NO_STORE });
  }

  const shared = {
    settings,
    coinUniverse: settings.coinUniverse,
    coins: settings.coinUniverse,
  };

  if (!debug) {
    return NextResponse.json(shared, { headers: NO_STORE });
  }

  const jar = await cookies();
  const rawCookie = jar.get(cookieName)?.value ?? null;

  return NextResponse.json({ ...shared, __debug: { rawCookie } }, { headers: NO_STORE });
}

export async function POST(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const badgeScope = resolveBadgeScope(req, { badge: params?.badge ?? null });
  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }
  const badge = (badgeScope.effectiveBadge || "").trim();
  const session = resolved.session;
  if (!badge) {
    return NextResponse.json({ ok: false, error: "missing_session" }, { status: 401 });
  }
  adoptSessionRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
  });
  try {
    const body = await req.json();
    const incoming = body?.settings ?? {};
    return await withDbContext(
      { userId: session.userId, sessionId: badge, isAdmin: session.isAdmin, path: req.nextUrl.pathname, badgeParam: badgeScope.badgeParam },
      async (client) => {
        const { settings, cookie, persistedCoinUniverse } = await serializeSettingsCookie(
          incoming,
          { client, session, sessionKey: badge },
        );
        const res = NextResponse.json(
          {
            ok: true,
            settings: { ...settings, coinUniverse: persistedCoinUniverse ?? settings.coinUniverse },
          },
          { headers: NO_STORE },
        );
        res.cookies.set(cookie.name, cookie.value, cookie.options);
        return res;
      },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 400 });
  }
}

// Admin-only global universe update; regular users keep coins in their own cookie via POST.
export async function PUT(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const body = await req.json();
  const enable: string[] = Array.isArray(body.enable) ? body.enable : [];
  const disable = Array.isArray(body.disable) ? body.disable : [];
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const badgeScope = resolveBadgeScope(req, { badge: params?.badge ?? null });
  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }
  const badge = (badgeScope.effectiveBadge || "").trim();
  const session = resolved.session;
  const isAdmin = !!session?.isAdmin;
  if (!badge) {
    return NextResponse.json({ ok: false, error: "missing_session" }, { status: 401 });
  }
  adoptSessionRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
  });

  return await withDbContext(
    { userId: session.userId, sessionId: badge, isAdmin: session.isAdmin, path: req.nextUrl.pathname, badgeParam: badgeScope.badgeParam },
    async (client) => {
      if (isAdmin) {
        if (enable.length) {
          await client.query(
            `
              insert into settings.coin_universe(symbol, base_asset, quote_asset, enabled)
              select
                upper(s) as symbol,
                upper((public._split_symbol(s)).base)  as base_asset,
                upper((public._split_symbol(s)).quote) as quote_asset,
                true
              from unnest($1::text[]) s
              on conflict (symbol) do update
                set enabled     = true,
                    base_asset  = coalesce(settings.coin_universe.base_asset, excluded.base_asset),
                    quote_asset = coalesce(settings.coin_universe.quote_asset, excluded.quote_asset)
            `,
            [enable],
          );
          await client.query(`select settings.sp_mirror_universe_to_market()`); // idempotent
        }

        if (enable.length)
          await client.query(
            `insert into market.symbols(symbol)
                   select s from unnest($1::text[]) s
                   on conflict do nothing`,
            [enable],
          );

        if (enable.length)
          await client.query(
            `insert into settings.coin_universe(symbol, enabled)
                   select s, true from unnest($1::text[]) s
                   on conflict (symbol) do update set enabled = true`,
            [enable],
          );
        if (disable.length)
          await client.query(
            `update settings.coin_universe
                      set enabled = false
                    where symbol = any($1::text[])`,
            [disable],
          );

        await client.query(`select settings.sync_coin_universe(true, 'USDT')`);
        // keep admin's per-user/session copies in sync for RLS reads
        if (session?.userId) {
          await upsertUserCoinUniverse(
            session.userId,
            enable,
            { enable: true, autoDisable: true },
            client,
          );
          await upsertSessionCoinUniverse(
            badge,
            enable,
            { enable: true, context: { userId: session.userId, isAdmin: session.isAdmin } },
            client,
          );
        }
      } else if (session?.userId) {
        // Per-session universe override: treat "enable" list as desired set
        await upsertSessionCoinUniverse(
          badge,
          enable,
          { enable: true, context: { userId: session.userId, isAdmin: session.isAdmin } },
          client,
        );
      }

      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    },
  );
}
