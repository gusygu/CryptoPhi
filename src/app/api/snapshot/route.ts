// src/app/api/snapshot/route.ts
import { NextResponse } from "next/server";
import { requireUserSession } from "@/app/(server)/auth/session";
import {
  listSnapshotsForUser,
  createSnapshotForUser,
} from "@/core/features/snapshot";

type SnapshotRequestBody = {
  label?: string;
  scopeOverride?: string[] | null;
  appVersion?: string | null;
};

const parseBody = (payload: unknown): SnapshotRequestBody => {
  if (!payload || typeof payload !== "object") return {};
  const bag = payload as Record<string, unknown>;
  const label = typeof bag.label === "string" ? bag.label : undefined;
  const appVersion =
    typeof bag.appVersion === "string" ? bag.appVersion : undefined;
  const scopeOverride = Array.isArray(bag.scopeOverride)
    ? bag.scopeOverride.filter((entry): entry is string => typeof entry === "string")
    : null;
  return { label, scopeOverride, appVersion };
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await requireUserSession();
    const snapshots = await listSnapshotsForUser(session.email, 80);
    return NextResponse.json({ ok: true, snapshots });
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const status = message === "email_required" ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUserSession();
    const raw = await req.json().catch(() => ({}));
    const dto = parseBody(raw);

    const snapshot = await createSnapshotForUser({
      email: session.email,
      label: dto.label,
      appVersion: dto.appVersion,
      scopeOverride: dto.scopeOverride,
    });

    return NextResponse.json({ ok: true, snapshot });
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const status = message === "email_required" ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
