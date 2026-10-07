import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api/handler';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { resolveMediaFile } from '@/server/content/service';
import { getRequestMediaStorage } from '@/server/content/storage';
import { mediaIdSchema } from '@/server/content/validation';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, retryable: false } }, { status });
}

/**
 * GET /api/workspace/content/media/:id/file — authorized byte serving.
 *
 * This route intentionally bypasses the JSON API wrapper: it streams bytes
 * (memory backend) or redirects to a short-lived signed bucket URL (Supabase
 * backend) after the same actor + membership + row-ownership checks. The id
 * is opaque — paths are never accepted from the caller, so traversal is
 * impossible.
 */
export async function GET(_request: Request, extra: RouteParams): Promise<NextResponse> {
  const { id } = await extra.params;
  if (!mediaIdSchema.safeParse(id).success) {
    return jsonError('INVALID_INPUT', 'Media id must be a valid UUID.', 400);
  }

  const actorResult = await resolveActor();
  if (!actorResult.ok) return errorResponse(actorResult.error);

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return errorResponse(repoResult.error);

  const storageResult = await getRequestMediaStorage();
  if (!storageResult.ok) return errorResponse(storageResult.error);

  const result = await resolveMediaFile(
    actorResult.data,
    repoResult.data,
    storageResult.data,
    id,
  );
  if (!result.ok) {
    if (result.error.code === 'MEDIA_NOT_FOUND') {
      return jsonError('MEDIA_NOT_FOUND', 'Media file not found.', 404);
    }
    return errorResponse(result.error);
  }

  const resolved = result.data;
  if (resolved.kind === 'redirect') {
    return NextResponse.redirect(resolved.url);
  }

  const safeName = resolved.filename.replace(/["\r\n]/g, '');
  return new NextResponse(resolved.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': resolved.mimeType,
      'Content-Length': String(resolved.bytes.byteLength),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
