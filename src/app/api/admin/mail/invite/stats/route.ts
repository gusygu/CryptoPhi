// src/app/api/admin/mail/invite/stats/route.ts
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { getAdminInviteStats } from "@/core/features/admin-comms";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session?.isAdmin || !session.email) {
      return NextResponse.json(
        { ok: false, error: "Not authorized" },
        { status: 403 }
      );
    }
    const stats = await getAdminInviteStats(session.email);
    return NextResponse.json({ ok: true, stats });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
