import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { getJobRepository } from '@/server/db';
import { runDueJobs } from '@/server/email/sequence-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET|POST /api/cron/email
 * Sweeps due sequence step jobs (Phase 11). Called by operator scheduler
 * (Vercel Cron / pg_cron via pg_net) with CRON_SECRET. Never by user session.
 */
function authorized(request: Request): boolean {
  const secret = serverEnv().cronSecret;
  if (!secret) return false;
  const presented =
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret') ??
    '';
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sweep() {
  const secret = serverEnv().cronSecret;
  if (!secret) {
    return NextResponse.json({ ok: false, error: { code: 'CRON_NOT_CONFIGURED', message: 'Email cron is not configured. Set CRON_SECRET.' } }, { status: 503 });
  }
  const repoResult = getJobRepository();
  if (!repoResult.ok) {
    return NextResponse.json({ ok: false, error: { code: repoResult.error.code, message: repoResult.error.message } }, { status: 500 });
  }
  const result = await runDueJobs(repoResult.data);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: result.data });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: { code: 'CRON_UNAUTHORIZED', message: 'Invalid or missing cron secret.' } }, { status: 401 });
  }
  return sweep();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: { code: 'CRON_UNAUTHORIZED', message: 'Invalid or missing cron secret.' } }, { status: 401 });
  }
  return sweep();
}
