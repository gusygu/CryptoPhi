import { NextRequest, NextResponse } from "next/server";
import { withDbContext } from "@/core/db/pool_server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { getEffectiveSettingsForBadge } from "@/lib/settings/server";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;

  const resolved = await resolveBadgeRequestContext(req, params);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const { badge, badgeScope, session } = resolved;
  const resolvedFromSessionMap = (session as any)?.resolvedFromSessionMap ?? false;

  const dbCtx = await withDbContext(
    {
      userId: session.userId,
      sessionId: badge,
      isAdmin: session.isAdmin,
      path: req.nextUrl.pathname,
      badgeParam: badgeScope.badgeParam,
      resolvedFromSessionMap,
    },
    async (client, meta) => {
      const { rows } = await client.query<{
        session_id: string | null;
        user_id: string | null;
        pid: number | null;
        txid: string | null;
        now: string;
      }>(
        `select
           nullif(current_setting('app.session_id', true), '') as session_id,
           nullif(current_setting('app.user_id', true), '')   as user_id,
           pg_backend_pid() as pid,
           txid_current_if_assigned() as txid,
           now()::text as now`,
      );
      const row = rows[0] ?? { session_id: null, user_id: null, pid: null, txid: null, now: "" };
      return {
        current_session_id: row.session_id ?? null,
        current_user_id: row.user_id ?? null,
        pid: row.pid,
        txid: row.txid,
        now: row.now,
        requestId: meta.requestId,
        dbSeen: meta.dbSeen,
      };
    },
  );

  const settings = await getEffectiveSettingsForBadge(badge).catch(() => null);
  const sessionCookie = req.cookies.get("session")?.value ?? null;
  const badgeCookie = req.cookies.get("sessionId")?.value ?? null;

  return NextResponse.json({
    badge: {
      param: badgeScope.badgeParam,
      header: badgeScope.badgeHeader,
      cookie: badgeScope.badgeCookie,
      legacyCookie: badgeScope.legacyCookie,
      query: badgeScope.badgeQuery,
      effective: badge,
    },
    session: {
      userId: session.userId,
      email: session.email,
      nickname: session.nickname,
      isAdmin: session.isAdmin,
      status: session.status,
      resolvedFromSessionMap,
    },
    cookies: {
      session: sessionCookie,
      appSessionId: badgeCookie,
    },
    path: req.nextUrl.pathname,
    db: dbCtx,
    effectiveSettings: settings
      ? {
          badge: settings.badge,
          coinUniverse: settings.settings.coinUniverse,
          params: settings.settings.params.values,
          timing: settings.settings.timing,
          poll: settings.settings.poll,
        }
      : null,
  });
}
