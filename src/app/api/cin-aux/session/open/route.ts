import { NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { withDbContext } from "@/core/db/pool_server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const resolved = await resolveBadgeRequestContext(req as any, { badge: null });
    if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
    const badge = resolved.badge;
    const session = resolved.session;

    return withDbContext(
      {
        userId: session.userId,
        sessionId: badge,
        isAdmin: session.isAdmin,
        path: (req as any)?.nextUrl?.pathname ?? "",
        badgeParam: null,
        resolvedFromSessionMap: (session as any)?.resolvedFromSessionMap ?? false,
      },
      async (client) => {
        const { rows } = await client.query(
          `
          INSERT INTO cin_aux.rt_session (owner_user_id, window_label)
          VALUES ($1, 'manual-open')
          RETURNING session_id, started_at;
          `,
          [session.userId],
        );

        const createdSession = rows[0];
        const id = createdSession.session_id;

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

        return NextResponse.json(
          {
            ok: true,
            sessionId: id,
            startedAt: createdSession.started_at,
          },
          { headers: { "Cache-Control": "no-store, max-age=0" } },
        );
      },
    );
  } catch (err: any) {
    console.error("[cin-aux legacy] session/open error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", message: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}

