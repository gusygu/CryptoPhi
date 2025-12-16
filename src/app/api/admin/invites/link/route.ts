import { NextRequest } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
import { jsonError, jsonOk } from "@/app/api/_lib/responses";
import { createInviteLink, InviteError } from "@/core/features/invites/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return jsonError("UNAUTHENTICATED", "Sign in required", 401);
    }

    const body = await req.json().catch(() => ({}));
    const email =
      typeof body?.email === "string"
        ? body.email
        : typeof body?.targetEmail === "string"
        ? body.targetEmail
        : "";

    if (!email || typeof email !== "string") {
      return jsonError("INVALID_EMAIL", "email is required", 400);
    }

    const role = typeof body?.role === "string" ? body.role : null;
    const note = typeof body?.note === "string" ? body.note : null;

    const { link, stats } = await createInviteLink({
      session,
      recipientEmail: email,
      role,
      note,
      origin: req.headers.get("origin"),
    });

    return jsonOk({
      inviteId: link.inviteId,
      inviteUrl: link.inviteUrl,
      expiresAt: link.expiresAt,
      stats,
    });
  } catch (err: any) {
    if (err instanceof InviteError) {
      return jsonError(err.code, err.message, err.status);
    }
    console.error("[api/admin/invites/link] failed", err);
    return jsonError("INVITE_CREATE_FAILED", err?.message ?? "Failed to create invite", 500);
  }
}

