// src/app/api/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAll, serializeSettingsCookie } from "@/lib/settings/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { query } from "@/core/db/pool_server";
import { upsertUserCoinUniverse } from "@/lib/settings/coin-universe";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const settings = await getAll();
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
  const rawCookie = jar.get("appSettings")?.value ?? null;

  return NextResponse.json({ ...shared, __debug: { rawCookie } }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming = body?.settings ?? {};
    const { settings, cookie } = await serializeSettingsCookie(incoming);
    const res = NextResponse.json({ ok: true, settings });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 400 });
  }
}

// Admin-only global universe update; regular users keep coins in their own cookie via POST.
export async function PUT(req: NextRequest) {
  const session = await getCurrentSession();
  const isAdmin = !!session?.isAdmin;
  const body = await req.json();
  const enable: string[] = Array.isArray(body.enable) ? body.enable : [];
  const disable = Array.isArray(body.disable) ? body.disable : [];

  if (isAdmin) {
    if (enable.length) {
      await query(`select settings.sp_upsert_coin_universe($1::text[])`, [enable]);
      await query(`select settings.sp_mirror_universe_to_market()`); // idempotent
    }

    if (enable.length)
      await query(`insert into market.symbols(symbol)
                   select s from unnest($1::text[]) s
                   on conflict do nothing`, [enable]);

    if (enable.length)
      await query(`insert into settings.coin_universe(symbol, enabled)
                   select s, true from unnest($1::text[]) s
                   on conflict (symbol) do update set enabled = true`, [enable]);
    if (disable.length)
      await query(`update settings.coin_universe
                      set enabled = false
                    where symbol = any($1::text[])`, [disable]);

    await query(`select settings.sync_coin_universe(true, 'USDT')`);
  } else if (session?.userId) {
    // Per-user universe override: treat "enable" list as desired set; auto-disable everything else for this user
    await upsertUserCoinUniverse(session.userId, enable, { autoDisable: true, enable: true });
    if (disable.length) {
      // If specific disables provided, remove them from desired set by reapplying without them
      const desired = enable.filter((s) => !disable.includes(s));
      await upsertUserCoinUniverse(session.userId, desired, { autoDisable: true, enable: true });
    }
  }

  return NextResponse.json({ ok: true });
}
