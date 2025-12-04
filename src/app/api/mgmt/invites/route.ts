// src/app/api/mgmt/invites/route.ts
import { NextResponse } from "next/server";
import {
  createInviteForManager,
  listManagerInvitesByEmail,
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
    text.includes("must");
  return badRequest ? 400 : 500;
}

export async function GET() {
  try {
    const { email, managerId } = await getManagerContext();
    if (!email || !managerId) {
      return unauthorized();
    }

    const invites = await listManagerInvitesByEmail(managerId);
    return NextResponse.json({ ok: true, invites });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: resolveErrorStatus(message) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { email, managerId, managerDisplayName } = await getManagerContext();
    if (!email || !managerId) {
      return unauthorized();
    }

    const body = await req.json().catch(() => ({}));
    const { targetEmail } = body ?? {};

    if (!targetEmail || typeof targetEmail !== "string") {
      return NextResponse.json(
        { ok: false, error: "targetEmail is required" },
        { status: 400 }
      );
    }

    const invite = await createInviteForManager({
      managerId,
      managerEmail: email,
      managerDisplayName,
      targetEmail,
    });

    return NextResponse.json({ ok: true, invite });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: resolveErrorStatus(message) }
    );
  }
}
