// src/app/api/admin/mail/invite/send/route.ts
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { sendAdminInviteEmail } from "@/core/features/admin-comms";

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
    const { toEmail, templateKey, inviteToken } = body ?? {};
    if (!toEmail || !templateKey) {
      return NextResponse.json(
        { ok: false, error: "toEmail and templateKey are required" },
        { status: 400 }
      );
    }

    const adminName =
      (session.nickname && session.nickname.trim()) || "CryptoPhi Admin";

    const result = await sendAdminInviteEmail({
      adminEmail: session.email,
      adminName,
      toEmail,
      templateKey,
      inviteToken,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
