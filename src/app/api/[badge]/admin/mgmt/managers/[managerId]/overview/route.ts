// src/app/api/admin/mgmt/managers/[managerId]/overview/route.ts
import { NextResponse } from "next/server";
import { getManagerOverview } from "@/core/features/admin-mgmt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: Request,
  { params }: { params: { managerId: string } }
) {
  try {
    const { managerId } = params;
    const overview = await getManagerOverview(managerId);
    if (!overview) {
      return NextResponse.json(
        { ok: false, error: "manager not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, overview });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
