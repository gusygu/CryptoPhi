// src/app/api/admin/mail/invite/link/route.ts
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { createAdminInviteLink } from "@/core/features/admin-comms";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const session = await getCurrentSession();
    if (!session?.isAdmin || !session.email) {
      return NextResponse.json(
        { ok: false, error: "Not authorized" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const targetEmail = typeof body?.targetEmail === "string" ? body.targetEmail.trim() : "";
    if (!targetEmail) {
      return NextResponse.json(
        { ok: false, error: "targetEmail is required" },
        { status: 400 }
      );
    }

    const { link, stats } = await createAdminInviteLink({
      adminEmail: session.email,
      targetEmail,
    });

    return NextResponse.json({ ok: true, link, stats });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
