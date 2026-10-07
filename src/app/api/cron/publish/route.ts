import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';
import { getJobMediaStorage } from '@/server/content/storage';
import { getJobRepository } from '@/server/db';
import { runDueJobs } from '@/server/social/publish/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET|POST /api/cron/publish
 * Sweeps due Nibrexo-held publish jobs (scheduled posts whose time arrived,
 * retries whose backoff elapsed, in-flight verifications). Called by the
 * hosting platform's scheduler (see vercel.json). Authorized by the
 * server-only NIBREXO_CRON_SECRET bearer token or, where injected, the
 * platform's own cron signature — never by a user session.
 */
function authorized(request: Request): boolean {
  const secret = serverEnv().cronSecret;
  if (!secret) return false;
  const presented =
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    new URL(request.url).searchParams.get('secret') ??
    '';
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sweep() {
  const repoResult = await getJobRepository();
  if (!repoResult.ok) {
    return NextResponse.json(
      { ok: false, error: { code: repoResult.error.code, message: repoResult.error.message } },
      { status: 500 },
    );
  }
  const storageResult = await getJobMediaStorage();
  if (!storageResult.ok) {
    return NextResponse.json(
      { ok: false, error: { code: storageResult.error.code, message: storageResult.error.message } },
      { status: 500 },
    );
  }
  const result = await runDueJobs(repoResult.data, storageResult.data);
  return NextResponse.json({ ok: true, data: result });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: { code: 'CRON_UNAUTHORIZED', message: 'Invalid or missing cron secret.' } },
      { status: 401 },
    );
  }
  return sweep();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: { code: 'CRON_UNAUTHORIZED', message: 'Invalid or missing cron secret.' } },
      { status: 401 },
    );
  }
  return sweep();
}
