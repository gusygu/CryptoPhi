// src/app/api/admin/mail/templates/route.ts
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { listAdminInviteTemplates } from "@/core/features/admin-comms";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session?.isAdmin) {
      return NextResponse.json(
        { ok: false, error: "Not authorized" },
        { status: 403 }
      );
    }

    const templates = await listAdminInviteTemplates();
    return NextResponse.json({ ok: true, templates });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
