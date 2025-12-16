import { NextRequest, NextResponse } from "next/server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";
import {
  resolvePreviewUniverseSnapshot,
  type PreviewUniverseOptions,
} from "@/app/api/engine/market/preview/universe/shared";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ensureUpper = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

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
  const coinsParam = url.searchParams.get("coins") || "";
  const quoteParam = url.searchParams.get("quote");
  const requestCoins = coinsParam
    .split(/[,\s]+/)
    .map((c) => ensureUpper(c))
    .filter(Boolean);

  const options: PreviewUniverseOptions = { quote: quoteParam };

  try {
    const snapshot = await resolvePreviewUniverseSnapshot(options);
    const previewSet = new Set(snapshot.symbols.map(ensureUpper));
    const previewBySymbol: Record<string, { available?: boolean; bridged?: boolean; antisym?: boolean; reason?: string | null }> =
      {};

    for (const sym of snapshot.symbols ?? []) {
      const upper = ensureUpper(sym);
      if (!upper) continue;
      previewBySymbol[upper] = { available: true };
    }

    for (const coin of requestCoins) {
      const symbol = `${coin}${snapshot.quote}`;
      const upper = ensureUpper(symbol);
      if (upper && !previewSet.has(upper)) {
        previewBySymbol[upper] = { available: false, reason: "not_listed" };
      }
    }

    return NextResponse.json(
      {
        ok: true,
        coins: snapshot.coins,
        symbols: snapshot.symbols,
        previewBySymbol,
        updatedAt: snapshot.updatedAt,
        note: snapshot.note,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: { code: "preview_error", message: String(err?.message ?? err) } },
      { status: 500 },
    );
  }
}
