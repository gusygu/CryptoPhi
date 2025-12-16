import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const paramsMaybe = (context as any)?.params;
  const params = paramsMaybe && typeof paramsMaybe.then === "function" ? await paramsMaybe : paramsMaybe;
  const resolution = await resolveBadgeRequestContext(req, params ?? {});
  if (!resolution.ok) {
    return NextResponse.json(resolution.body, { status: resolution.status });
  }

  const badge = resolution.badge;
  const session = resolution.session;
  await setRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
    path: req.nextUrl.pathname,
    badgeParam: params?.badge ?? null,
    resolvedFromSessionMap: session.resolvedFromSessionMap ?? false,
  });

  const url = new URL(req.url);
  const coins = url.searchParams.get("coins") || "";

  return NextResponse.json(
    {
      ok: false,
      error: { code: "cin_snapshot_unavailable", message: "cin-aux snapshot not implemented for this build" },
      coins,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
