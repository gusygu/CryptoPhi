import { getCurrentSession } from "@/app/(server)/auth/session";
import { jsonError, jsonOk } from "@/app/api/_lib/responses";
import { getInviteStatsForUser } from "@/core/features/invites/service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return jsonError("UNAUTHENTICATED", "Sign in required", 401);
    }

    const stats = await getInviteStatsForUser(session);
    return jsonOk({
      weekUsed: stats.weekUsed,
      weekLimit: stats.weekLimit,
      lifetimeUsed: stats.lifetimeUsed,
      lifetimeLimit: stats.lifetimeLimit,
      tier: stats.tier,
    });
  } catch (err: any) {
    console.error("[api/admin/mail/invite/stats] failed", err);
    return jsonError("INVITE_STATS_FAILED", err?.message ?? "Failed to read invite stats", 500);
  }
}
