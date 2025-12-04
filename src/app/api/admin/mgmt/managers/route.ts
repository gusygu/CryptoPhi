// src/app/api/admin/mgmt/managers/route.ts
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import {
  listManagers,
  upsertManager,
} from "@/core/features/admin-mgmt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session?.isAdmin) {
      return NextResponse.json(
        { ok: false, error: "Admin access required" },
        { status: 403 }
      );
    }

    const managers = await listManagers();
    return NextResponse.json({ ok: true, managers });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getCurrentSession();
    if (!session?.isAdmin) {
      return NextResponse.json(
        { ok: false, error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      manager_id,
      email,
      display_name,
      signature_email,
      status,
    } = body ?? {};

    if (!email || !signature_email) {
      return NextResponse.json(
        { ok: false, error: "email and signature_email are required" },
        { status: 400 }
      );
    }

    const manager = await upsertManager({
      manager_id,
      email,
      display_name,
      signature_email,
      status,
      actorEmail: session.email,
    });

    return NextResponse.json({ ok: true, manager });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
