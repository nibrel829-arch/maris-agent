import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { syncAllDueInboxAccounts } from '@/server/inbox/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = serverEnv().cronSecret;
  if (!secret) return false;
  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ?? '';
  if (!presented) return false;
  const received = Buffer.from(presented);
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function sweep(request: Request) {
  if (!serverEnv().cronSecret) {
    return NextResponse.json({ ok: false, error: { code: 'CRON_NOT_CONFIGURED', message: 'Inbox sync cron is not configured.' } }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: { code: 'CRON_UNAUTHORIZED', message: 'Invalid or missing cron secret.' } }, { status: 401 });
  }
  const result = await syncAllDueInboxAccounts();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: { code: result.error.code, message: result.error.message } }, { status: 503 });
  }
  return NextResponse.json({ ok: true, data: result.data });
}

export async function GET(request: Request) {
  return sweep(request);
}

export async function POST(request: Request) {
  return sweep(request);
}
