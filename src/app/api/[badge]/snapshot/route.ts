// src/app/api/snapshot/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/app/(server)/auth/session";
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

type RouteContext = { params: { badge?: string } };

function resolveBadge(req: NextRequest, ctx?: RouteContext) {
  const fromParams = ctx?.params?.badge ?? "";
  const fromHeader = req.headers.get("x-app-session") || "";
  const fromPath = req.nextUrl.pathname.split("/").filter(Boolean)[1] ?? "";
  return (fromParams || fromHeader || fromPath || "").trim() || "global";
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "login_required" },
        { status: 401 }
      );
    }
    const badge = resolveBadge(req, ctx);
    const snapshots = await listSnapshotsForUser(session.email, 80, badge);
    return NextResponse.json({ ok: true, snapshots });
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const status = message === "email_required" ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "login_required" },
        { status: 401 }
      );
    }
    const raw = await req.json().catch(() => ({}));
    const dto = parseBody(raw);
    const badge = resolveBadge(req, ctx);

    const snapshot = await createSnapshotForUser({
      email: session.email,
      label: dto.label,
      appVersion: dto.appVersion,
      scopeOverride: dto.scopeOverride,
      appSessionId: badge,
      appUserId: session.userId ?? null,
    });

    return NextResponse.json({ ok: true, snapshot });
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const status = message === "email_required" ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
