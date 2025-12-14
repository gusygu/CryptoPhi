// src/app/(server)/auth/session.ts
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, ensureAppSessionCookie } from "@/lib/auth/server";
import {
  ensureProfileEmailRow,
  backfillAccountTradesEmail,
} from "@/core/features/cin-aux/accountScope";
import { query, withDbContext } from "@/core/db";
import { isEmailSuspended } from "@/lib/auth/suspension";
import { adoptSessionRequestContext, setServerRequestContext } from "@/lib/server/request-context";
import { resolveBadgeScope, type BadgeScope } from "@/lib/server/badge-scope";

export type UserSessionStatus = "active" | "suspended" | "invited" | "unknown";

export type UserSession = {
  userId: string;
  email: string;
  nickname: string | null;
  isAdmin: boolean;
  status: UserSessionStatus;
};

export type SessionCtx = UserSession & { badge: string };

type ApiResult =
  | { ok: true; ctx: SessionCtx }
  | { ok: false; status: number; body: any };

const BADGE_RE = /^[A-Za-z0-9_-]{2,64}$/;

function cleanBadge(raw: string | null | undefined): string | null {
  const b = (raw ?? "").trim();
  if (!b) return null;
  if (b.toLowerCase() === "api") return null;
  if (!BADGE_RE.test(b)) return null;
  return b;
}

function logRequest(event: {
  requestId?: string;
  method?: string;
  pathname?: string;
  routeType: "api" | "page";
  badgeParam: string | null;
  resolvedBadge: string | null;
  userId: string | null;
  sessionId: string | null;
  status?: number;
  error?: string | null;
  resolvedFromSessionMap?: boolean;
}) {
  try {
    console.info(
      JSON.stringify({
        tag: "auth_request",
        ...event,
      }),
    );
  } catch {
    /* ignore */
  }
}

export async function readSessionEmail(): Promise<string | null> {
  const user = await getCurrentUser({ includeInactive: true });
  return user?.email?.toLowerCase() ?? null;
}

function mapUserToSession(user: Awaited<ReturnType<typeof getCurrentUser>>): UserSession | null {
  if (!user) return null;
  const status = (user.status as UserSessionStatus) ?? "unknown";
  const nickname =
    user.nickname ||
    (user.email.includes("@") ? user.email.split("@")[0] : user.email);

  return {
    userId: user.user_id,
    email: user.email.toLowerCase(),
    nickname,
    isAdmin: !!user.is_admin,
    status,
  };
}

export async function getCurrentSession(): Promise<UserSession | null> {
  const user = await getCurrentUser({ includeInactive: true });
  const session = mapUserToSession(user);
  adoptSessionRequestContext(null);
  if (session?.userId) {
    await ensureAppSessionCookie(session.userId);
  }
  return session;
}

async function ensureBadgeMapping(userId: string, badge: string): Promise<"ok" | "badge_not_owned"> {
  // resolve current owner; if none, bind; if other, reject
  const { rows } = await query<{ owner: string | null }>(
    `select auth.resolve_user_id_from_session($1) as owner`,
    [badge],
  );
  const owner = rows[0]?.owner ?? null;
  if (owner && owner !== userId) {
    return "badge_not_owned";
  }
  await withDbContext({ userId, sessionId: badge, path: "/auth/upsertSessionMap" }, (client) =>
    client.query(`select user_space.sp_upsert_session_map($1,$2)`, [badge, userId]),
  );
  return "ok";
}

function requestPath(req?: NextRequest | Request): string | undefined {
  try {
    return req ? new URL(req.url).pathname : undefined;
  } catch {
    return undefined;
  }
}

async function resolveSessionFromBadge(
  badge: string,
): Promise<(UserSession & { resolvedFromSessionMap: true }) | null> {
  const clean = cleanBadge(badge);
  if (!clean) return null;

  setServerRequestContext({
    userId: null,
    isAdmin: false,
    sessionId: clean,
    badgeParam: clean,
    resolvedFromSessionMap: true,
  });

  try {
    const { rows } = await query<{
      user_id: string | null;
      email: string | null;
      nickname: string | null;
      is_admin: boolean | null;
      status: string | null;
    }>(
      `select
         u.user_id::text,
         lower(u.email) as email,
         u.nickname,
         coalesce(u.is_admin, false) as is_admin,
         coalesce(u.status, 'unknown') as status
       from auth."user" u
      where u.user_id = auth.resolve_user_id_from_session($1)
      limit 1`,
      [clean],
      { sessionId: clean },
    );
    const row = rows[0];
    if (!row?.user_id) return null;
    const email = String(row.email ?? "").toLowerCase();
    const nickname =
      row.nickname ||
      (email.includes("@") ? email.split("@")[0] : email);
    const session: UserSession = {
      userId: row.user_id,
      email,
      nickname,
      isAdmin: !!row.is_admin,
      status: (row.status as UserSessionStatus) ?? "unknown",
    };
    adoptSessionRequestContext({ userId: session.userId, isAdmin: session.isAdmin, sessionId: clean });
    setServerRequestContext({
      userId: session.userId,
      isAdmin: session.isAdmin,
      sessionId: clean,
      badgeParam: clean,
      resolvedFromSessionMap: true,
    });
    return { ...session, resolvedFromSessionMap: true };
  } catch (err) {
    console.warn("[auth] resolveSessionFromBadge failed:", err);
    return null;
  }
}

export async function requireUserSessionPage(badgeParam: string): Promise<SessionCtx> {
  const badge = cleanBadge(badgeParam);
  const resolvedFromSessionMap = false;
  if (!badge) {
    logRequest({
      routeType: "page",
      badgeParam,
      resolvedBadge: null,
      userId: null,
      sessionId: null,
      pathname: "",
      error: "badge_missing",
    });
    redirect("/auth?err=badge_missing");
  }

  const session = await getCurrentSession();
  if (!session) {
    logRequest({
      routeType: "page",
      badgeParam,
      resolvedBadge: badge,
      userId: null,
      sessionId: badge,
      pathname: "",
      error: "login_required",
    });
    redirect("/auth?err=login_required");
  }

  if (session.status === "suspended" || isEmailSuspended(session.email)) {
    logRequest({
      routeType: "page",
      badgeParam,
      resolvedBadge: badge,
      userId: session.userId,
      sessionId: badge,
      pathname: "",
      error: "account_suspended",
    });
    redirect("/auth?err=account_suspended");
  }

  const mapping = await ensureBadgeMapping(session.userId, badge);
  if (mapping === "badge_not_owned") {
    logRequest({
      routeType: "page",
      badgeParam,
      resolvedBadge: badge,
      userId: session.userId,
      sessionId: badge,
      pathname: "",
      error: "badge_not_owned",
    });
    redirect("/auth?err=badge_not_owned");
  }

  adoptSessionRequestContext({ userId: session.userId, isAdmin: session.isAdmin, sessionId: badge });
  setServerRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
    path: null,
    badgeParam,
    resolvedFromSessionMap,
  });
  try {
    await ensureProfileEmailRow(session.email, session.nickname);
    await backfillAccountTradesEmail(session.email);
  } catch (err) {
    console.warn("[requireUserSessionPage] failed to sync profile email:", err);
  }
  return { ...session, badge };
}

export async function requireUserSessionApi(
  badgeParam: string,
  req?: NextRequest | Request,
): Promise<ApiResult> {
  const badge = cleanBadge(badgeParam);
  const pathname = requestPath(req);
  if (!badge) {
    return { ok: false, status: 400, body: { error: "invalid_badge" } };
  }

  let session = await getCurrentSession();
  let resolvedFromSessionMap = false;

  if (!session) {
    const fromMap = await resolveSessionFromBadge(badge);
    if (fromMap) {
      session = fromMap;
      resolvedFromSessionMap = true;
    }
  }

  if (!session) {
    logRequest({
      routeType: "api",
      badgeParam,
      resolvedBadge: badge,
      userId: null,
      sessionId: badge,
      status: 401,
      error: "unknown_badge",
      pathname,
      resolvedFromSessionMap: false,
    });
    return { ok: false, status: 401, body: { error: "unknown_badge" } };
  }

  if (session.status === "suspended" || isEmailSuspended(session.email)) {
    logRequest({
      routeType: "api",
      badgeParam,
      resolvedBadge: badge,
      userId: session.userId,
      sessionId: badge,
      status: 403,
      error: "account_suspended",
      pathname,
      resolvedFromSessionMap,
    });
    return { ok: false, status: 403, body: { error: "account_suspended" } };
  }

  setServerRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
    path: pathname ?? null,
    badgeParam,
    resolvedFromSessionMap,
  });

  if (!resolvedFromSessionMap) {
    const mapping = await ensureBadgeMapping(session.userId, badge);
    if (mapping === "badge_not_owned") {
      logRequest({
        routeType: "api",
        badgeParam,
        resolvedBadge: badge,
        userId: session.userId,
        sessionId: badge,
        status: 401,
        error: "unknown_badge",
        pathname,
        resolvedFromSessionMap,
      });
      return { ok: false, status: 401, body: { error: "unknown_badge" } };
    }
  }

  adoptSessionRequestContext({ userId: session.userId, isAdmin: session.isAdmin, sessionId: badge });
  logRequest({
    routeType: "api",
    badgeParam,
    resolvedBadge: badge,
    userId: session.userId,
    sessionId: badge,
    status: 200,
    pathname,
    resolvedFromSessionMap,
  });
  return { ok: true, ctx: { ...session, badge, resolvedFromSessionMap } };
}

type BadgeResolution =
  | { ok: true; badge: string; badgeScope: BadgeScope; session: SessionCtx & { resolvedFromSessionMap: boolean } }
  | { ok: false; status: number; body: any; badgeScope: BadgeScope };

export async function resolveBadgeRequestContext(
  req: NextRequest,
  params?: { badge?: string | null },
): Promise<BadgeResolution> {
  const badgeScope = resolveBadgeScope(req, { badge: params?.badge ?? null });
  const badge = cleanBadge(badgeScope.effectiveBadge);
  if (!badge) {
    return { ok: false, status: 400, body: { error: "invalid_badge" }, badgeScope };
  }
  const auth = await requireUserSessionApi(badge, req);
  if (!auth.ok) {
    return { ok: false, status: auth.status, body: auth.body, badgeScope };
  }
  return {
    ok: true,
    badge,
    badgeScope,
    session: { ...auth.ctx, resolvedFromSessionMap: (auth.ctx as any)?.resolvedFromSessionMap ?? false },
  };
}

export async function resolveUserSessionForBadge(
  badge: string,
): Promise<(UserSession & { resolvedFromSessionMap: boolean }) | null> {
  return resolveSessionFromBadge(badge);
}

// Legacy helper kept for page components still calling requireUserSession()
export async function requireUserSession(badgeParam?: string): Promise<SessionCtx> {
  const jar = await cookies();
  const badge =
    cleanBadge(badgeParam) ??
    cleanBadge(jar.get("sessionId")?.value ?? null) ??
    cleanBadge(jar.get("appSessionId")?.value ?? null);
  if (!badge) {
    redirect("/auth?err=badge_missing");
  }
  return requireUserSessionPage(badge);
}
