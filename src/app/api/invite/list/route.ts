import { NextRequest } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { jsonError, jsonOk } from "@/app/api/_lib/responses";
import { listInvites } from "@/core/features/invites/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session || !session.isAdmin) {
      return jsonError("FORBIDDEN", "Admin access required", 403);
    }

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") as "pending" | "all" | null) ?? "pending";
    const limit = Number(url.searchParams.get("limit") ?? "50");

    const items = await listInvites({
      status: status === "all" ? "all" : "pending",
      limit,
    });

    return jsonOk({ items });
  } catch (err: any) {
    console.error("[api/invite/list] failed", err);
    return jsonError("INVITE_LIST_FAILED", err?.message ?? "Failed to list invites", 500);
  }
}

