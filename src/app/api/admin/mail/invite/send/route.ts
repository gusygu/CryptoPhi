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
    if (!session.isAdmin) {
      return jsonError("FORBIDDEN", "Admin access required", 403);
    }

    const body = await req.json().catch(() => ({}));
    const toEmail =
      typeof body?.toEmail === "string"
        ? body.toEmail
        : typeof body?.email === "string"
        ? body.email
        : "";
    const templateKey = typeof body?.templateKey === "string" ? body.templateKey : null;

    if (!toEmail || !templateKey) {
      return jsonError("INVALID_REQUEST", "toEmail and templateKey are required", 400);
    }

    const { link, stats } = await createInviteLink({
      session,
      recipientEmail: toEmail,
      role: null,
      origin: req.headers.get("origin"),
    });

    return jsonOk({
      inviteId: link.inviteId,
      inviteUrl: link.inviteUrl,
      expiresAt: link.expiresAt,
      stats,
      sent: false,
      message: "Email sending is disabled; share the invite URL manually.",
    });
  } catch (err: any) {
    if (err instanceof InviteError) {
      return jsonError(err.code, err.message, err.status);
    }
    console.error("[api/admin/mail/invite/send] failed", err);
    return jsonError("INVITE_SEND_FAILED", err?.message ?? "Failed to send invite", 500);
  }
}

