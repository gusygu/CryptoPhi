import { NextResponse } from "next/server";
import { db } from "@/core/db/db";
import { listRuntimeSessions } from "@/core/features/cin-aux/runtimeQueries";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";

// GET: list sessions
export async function GET(
  _req: Request,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const resolved = await resolveBadgeRequestContext(req as any, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = resolved.badge;
  try {
    const session = resolved.session;
    const sessions = await listRuntimeSessions(session.userId);
    return NextResponse.json(sessions);
  } catch (err: any) {
    console.error("[cin-aux] runtime sessions GET error:", err?.message ?? err);
    // degrade gracefully: return empty list so client UI stays usable
    return NextResponse.json([], { status: 200, headers: { "x-cin-aux-error": String(err?.message ?? err) } });
  }
}

// POST: create session
export async function POST(
  _req: Request,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const params =
    typeof (context as any)?.params?.then === "function"
      ? await (context as { params: Promise<{ badge?: string }> }).params
      : (context as { params: { badge?: string } }).params;
  const resolved = await resolveBadgeRequestContext(_req as any, params);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const badge = resolved.badge;
  const session = resolved.session;
  try {
    const { rows } = await db.query(
      `
      INSERT INTO cin_aux.rt_session (owner_user_id, window_label)
      VALUES ($1, 'manual-open')
      RETURNING session_id, started_at;
      `
    , [session.userId]);

    const createdSession = rows[0];
    const id = createdSession.session_id;

    await db.query(
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
      [id]
    );

    return NextResponse.json({
      ok: true,
      sessionId: id,
      startedAt: createdSession.started_at,
    });
  } catch (err: any) {
    console.error("POST runtime/sessions error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
