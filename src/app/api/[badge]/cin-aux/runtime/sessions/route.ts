import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";
import { withDbContext } from "@/core/db/pool_server";
import { mapRuntimeSessionRow } from "@/core/features/cin-aux/runtimeQueries";

async function unwrapParams(context: any): Promise<{ badge?: string }> {
  return typeof context?.params?.then === "function" ? await context.params : context?.params ?? {};
}

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const { badge } = await unwrapParams(context);
  const resolved = await resolveBadgeRequestContext(req, { badge });
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
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
          const { rows } = await client.query(
            `
              SELECT s.*, recon.cin_total_mtm_usdt, recon.ref_total_usdt, recon.delta_usdt, recon.delta_ratio
                FROM cin_aux.v_rt_session_summary s
                LEFT JOIN cin_aux.v_rt_session_recon recon
                  ON recon.session_id = s.session_id
               WHERE s.owner_user_id = $1
               ORDER BY s.started_at DESC
            `,
            [userId],
          );
          const sessions = Array.isArray(rows) ? rows.map((row) => {
            try {
              return mapRuntimeSessionRow(row);
            } catch {
              return null;
            }
          }).filter(Boolean) as any[] : [];
          return { ok: true, sessions, active: sessions[0] ?? null };
        } catch {
          return { ok: true, sessions: [], active: null };
        }
      },
    );
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err: any) {
    return NextResponse.json({ ok: true, sessions: [], active: null });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const { badge } = await unwrapParams(context);
  const resolved = await resolveBadgeRequestContext(req, { badge });
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }
  const badgeEffective = resolved.badge;
  const userId = resolved.session.userId;
  const resolvedFromSessionMap = (resolved.session as any)?.resolvedFromSessionMap ?? false;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const sessionUuid = body.session_uuid ?? null;
  const sessionIdFromBody =
    sessionUuid != null && Number.isFinite(Number(sessionUuid)) ? Number(sessionUuid) : null;
  const windowLabel = (body as any)?.window_label ?? null;

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
        if (sessionIdFromBody != null) {
          try {
            const { rows } = await client.query(
              `
              SELECT s.*, recon.cin_total_mtm_usdt, recon.ref_total_usdt, recon.delta_usdt, recon.delta_ratio
                FROM cin_aux.v_rt_session_summary s
                LEFT JOIN cin_aux.v_rt_session_recon recon
                  ON recon.session_id = s.session_id
               WHERE s.owner_user_id = $1
                 AND s.session_id = $2
               ORDER BY s.started_at DESC
              `,
              [userId, sessionIdFromBody],
            );
            const sessions = Array.isArray(rows)
              ? rows.map((row) => {
                  try {
                    return mapRuntimeSessionRow(row);
                  } catch {
                    return null;
                  }
                }).filter(Boolean) as any[]
              : [];
            const active = sessions[0] ?? null;
            return {
              ok: true,
              sessions,
              active,
              sessionId: active?.sessionId ?? sessionIdFromBody,
              startedAt: active?.startedAt ?? null,
            };
          } catch {
            return {
              ok: true,
              sessions: [],
              active: null,
              sessionId: sessionIdFromBody,
              startedAt: null,
            };
          }
        }

        try {
          const { rows } = await client.query(
            `
            INSERT INTO cin_aux.rt_session (owner_user_id, window_label)
            VALUES ($1, COALESCE($2::text, 'manual-open'))
            RETURNING session_id, started_at;
            `,
            [userId, windowLabel],
          );

          const createdSession = rows?.[0];
          const id = createdSession?.session_id ?? null;

          if (id != null) {
            try {
              await client.query(
                `
                INSERT INTO cin_aux.rt_imprint_luggage (
                  session_id,
                  imprint_principal_churn_usdt,
                  imprint_profit_churn_usdt,
                  imprint_generated_profit_usdt,
                  imprint_trace_sum_usdt,
                  imprint_devref_sum_usdt,
                  luggage_total_principal_usdt,
                  luggage_total_profit_usdt
                )
                VALUES ($1,0,0,0,0,0,0,0)
                `,
                [id],
              );
            } catch {
              /* ignore bootstrap failure */
            }
          }

          return {
            ok: true,
            sessionId: id,
            startedAt: createdSession?.started_at ?? null,
          };
        } catch {
          return {
            ok: true,
            sessionId: null,
            startedAt: null,
          };
        }
      },
    );
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ ok: true, sessionId: null, startedAt: null });
  }
}
