import { NextResponse } from "next/server";

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    {
      status,
      headers: NO_STORE,
    }
  );
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    { ok: true, data },
    {
      ...init,
      headers: { ...(init?.headers ?? {}), ...NO_STORE },
    }
  );
}

export function noStoreHeaders(extra?: HeadersInit) {
  return { ...NO_STORE, ...(extra ?? {}) };
}
