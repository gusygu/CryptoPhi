import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { query } from "@/core/db/pool_server";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: { params: { badge?: string } }) {
  const jar = await cookies();
  const hdrs = await headers();
  const badgeParam = context?.params?.badge ?? null;
  const badgeHeader = hdrs.get("x-app-session") || null;
  const badgeCookie = jar.get("sessionId")?.value ?? null;
  const legacy = jar.get("appSessionId")?.value ?? jar.get("app_session_id")?.value ?? null;
  const authCookie = jar.get("session")?.value ?? null;

  const dbCtx = await query<{ session_id: string | null; user_id: string | null }>(
    `select
       nullif(current_setting('app.current_session_id', true), '') as session_id,
       nullif(current_setting('app.current_user_id', true), '')   as user_id`
  );

  return NextResponse.json({
    badge: {
      param: badgeParam,
      header: badgeHeader,
      cookie: badgeCookie,
      legacyCookie: legacy,
    },
    authCookiePresent: !!authCookie,
    db: {
      current_session_id: dbCtx.rows[0]?.session_id ?? null,
      current_user_id: dbCtx.rows[0]?.user_id ?? null,
    },
    path: req.nextUrl.pathname,
  });
}
