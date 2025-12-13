import { NextResponse } from 'next/server';
import { buildHealthSnapshot, buildStatusReport } from '@/core/api/vitals';
import type { HealthOptions } from '@/core/api/vitals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: HealthOptions = {
    includeAll: url.searchParams.get('includeAll') === '1',
    coin: url.searchParams.get('coin') ?? undefined,
    depth: url.searchParams.has('depth') ? Number(url.searchParams.get('depth')) : undefined,
  };

  const [status, health] = await Promise.all([
    Promise.resolve(buildStatusReport()),
    buildHealthSnapshot(params),
  ]);

  return NextResponse.json({
    ok: health.ok,
    ts: Date.now(),
    routes: {
      status: '/api/vitals/status',
      health: '/api/vitals/health',
    },
    status,
    health: {
      ts: health.ts,
      coins: health.coins,
      counts: health.counts,
      echo: health.echo,
      ok: health.ok,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  return NextResponse.json({
    ok: true,
    id: `vitals:${now}`,
    received: body ?? null,
    ts: now,
  });
}
