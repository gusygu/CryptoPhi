import { NextRequest, NextResponse } from "next/server";
import "@/app/(server)/wire-converter";
import { buildDynamicsSnapshot } from "@/core/converters/Converter.server";
import { resolveBadgeRequestContext } from "@/app/(server)/auth/session";
import { setRequestContext } from "@/lib/server/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ensureUpper = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

const parseCsv = (value: string | null | undefined) => {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => ensureUpper(s))
    .filter(Boolean);
};

const dedupe = (values: string[]) => Array.from(new Set(values));

const defaultCoins = () =>
  (process.env.NEXT_PUBLIC_COINS ?? "BTC,ETH,BNB,SOL,ADA,XRP,USDT")
    .split(",")
    .map((s) => ensureUpper(s))
    .filter(Boolean);

export async function GET(
  req: NextRequest,
  context: { params: { badge?: string } } | { params: Promise<{ badge?: string }> },
) {
  const paramsMaybe = (context as any)?.params;
  const params = paramsMaybe && typeof paramsMaybe.then === "function" ? await paramsMaybe : paramsMaybe;
  const url = req.nextUrl;
  const badgeParam = params?.badge ?? null;
  const base = ensureUpper(url.searchParams.get("base") ?? url.searchParams.get("Ca"));
  const quote = ensureUpper(url.searchParams.get("quote") ?? url.searchParams.get("Cb"));

  if (!base || !quote) {
    return NextResponse.json(
      { ok: false, error: "missing_base_or_quote" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const resolution = await resolveBadgeRequestContext(req, params ?? {});
  if (!resolution.ok) {
    return NextResponse.json(resolution.body, {
      status: resolution.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const badge = resolution.badge;
  const session = resolution.session;

  await setRequestContext({
    userId: session.userId,
    isAdmin: session.isAdmin,
    sessionId: badge,
    path: url.pathname,
    badgeParam,
    resolvedFromSessionMap: session.resolvedFromSessionMap ?? false,
  });

  const requestId = req.headers.get("x-request-id") ?? url.searchParams.get("requestId") ?? null;
  console.info("[dynamics_api]", {
    routeScope: "badge",
    badgeParam,
    badge,
    userId: session.userId,
    effectiveSessionId: badge,
    requestId,
    path: url.pathname,
  });

  const coinsParam = parseCsv(url.searchParams.get("coins"));
  const coins = dedupe(coinsParam.length ? coinsParam : defaultCoins());

  const candidatesParam = parseCsv(url.searchParams.get("candidates"));
  const candidates = dedupe(
    candidatesParam.length ? candidatesParam : coins.filter((c) => c !== base && c !== quote),
  );

  const histLen = Number(url.searchParams.get("histLen"));
  const bins = Number(url.searchParams.get("bins"));

  try {
    const snapshot = await buildDynamicsSnapshot({
      base,
      quote,
      Ca: base,
      Cb: quote,
      coinsUniverse: coins,
      candidates,
      histLen: Number.isFinite(histLen) ? histLen : undefined,
      histogramBins: Number.isFinite(bins) ? bins : undefined,
    });

    return NextResponse.json(
      { ok: true, snapshot },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
