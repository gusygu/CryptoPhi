import { getCurrentSession } from "@/app/(server)/auth/session";
import { jsonError, jsonOk } from "@/app/api/_lib/responses";
import { listAdminInviteTemplates } from "@/core/features/admin-comms";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session || !session.isAdmin) {
      return jsonError("FORBIDDEN", "Admin access required", 403);
    }

    try {
      const templates = await listAdminInviteTemplates();
      return jsonOk({ templates });
    } catch (err) {
      console.warn("[api/admin/mail/templates] falling back to empty list", err);
      return jsonOk({ templates: [] });
    }
  } catch (err: any) {
    console.error("[api/admin/mail/templates] failed", err);
    return jsonError("TEMPLATES_FAILED", err?.message ?? "Failed to list templates", 500);
  }
}

