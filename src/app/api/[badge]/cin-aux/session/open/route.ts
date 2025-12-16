import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { withDbContext } from "@/core/db/pool_server";
import { setRequestContext } from "@/lib/server/request-context";

async function unwrapParams(context: any): Promise<{ badge?: string }> {
  return typeof context?.params?.then === "function" ? await context.params : context?.params ?? {};
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
  const sessionId = resolved.badge;
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
    await setRequestContext({ userId, sessionId });
    const payload = await withDbContext(
      {
        userId,
        sessionId,
        isAdmin: resolved.session.isAdmin,
        path: req.nextUrl.pathname,
        badgeParam: badge ?? null,
        resolvedFromSessionMap,
      },
      async (client, meta) => {
        if (sessionIdFromBody != null) {
          try {
            const { rows } = await client.query(
              `
              SELECT session_id, started_at
                FROM cin_aux.rt_session
               WHERE owner_user_id = $1
                 AND session_id = $2
               ORDER BY started_at DESC
               LIMIT 1;
              `,
              [userId, sessionIdFromBody],
            );
            const existing = rows?.[0];
            if (existing) {
              return {
                ok: true,
                sessionId: existing.session_id,
                startedAt: existing.started_at,
                requestId: meta.requestId,
              };
            }
          } catch {
            /* ignore missing table/view */
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
            requestId: meta.requestId,
          };
        } catch {
          return { ok: true, sessionId: null, startedAt: null, requestId: meta.requestId };
        }
      },
    );
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ ok: true, sessionId: null, startedAt: null });
  }
}
