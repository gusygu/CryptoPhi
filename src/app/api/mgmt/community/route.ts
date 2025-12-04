// src/app/api/mgmt/community/route.ts
import { NextResponse } from "next/server";
import {
  listManagerCommunityByEmail,
  signalMember,
  toggleSuspendMember,
} from "@/core/features/manager-mgmt";
import { getManagerContext } from "../_ctx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Not authorized as manager" },
    { status: 403 }
  );
}

function resolveErrorStatus(message: string) {
  const text = message.toLowerCase();
  const badRequest =
    text.includes("limit") ||
    text.includes("invalid") ||
    text.includes("not found") ||
    text.includes("required") ||
    text.includes("must");
  return badRequest ? 400 : 500;
}

export async function GET() {
  try {
    const { email, managerId } = await getManagerContext();
    if (!email || !managerId) {
      return unauthorized();
    }

    const community = await listManagerCommunityByEmail(managerId);
    return NextResponse.json({ ok: true, community });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: resolveErrorStatus(message) }
    );
  }
}

// PATCH with action: "signal" | "suspend" | "unsuspend"
export async function PATCH(req: Request) {
  try {
    const { email, managerId } = await getManagerContext();
    if (!email || !managerId) {
      return unauthorized();
    }

    const body = await req.json().catch(() => ({}));
    const { memberId, action, reason } = body ?? {};

    if (!memberId || typeof memberId !== "string") {
      return NextResponse.json(
        { ok: false, error: "memberId is required" },
        { status: 400 }
      );
    }

    if (action === "signal") {
      await signalMember({ managerId, managerEmail: email, memberId, reason });
    } else if (action === "suspend") {
      await toggleSuspendMember({
        managerId,
        managerEmail: email,
        memberId,
        suspend: true,
      });
    } else if (action === "unsuspend") {
      await toggleSuspendMember({
        managerId,
        managerEmail: email,
        memberId,
        suspend: false,
      });
    } else {
      return NextResponse.json(
        { ok: false, error: "Unknown action" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: resolveErrorStatus(message) }
    );
  }
}
