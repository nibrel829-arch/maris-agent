import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api/handler';
import { getJobRepository, getRequestRepository } from '@/server/db';
import type { NibrexoRepository } from '@/server/db/types';
import { getRequestMediaStorage } from '@/server/content/storage';
import { filenameFromStoragePath } from '@/server/content/service';
import { isOrganizationIdShape, verifyAssetToken } from '@/server/email/asset-url';
import { MEDIA_RESPONSE_SECURITY_HEADERS } from '@/server/content/media-headers';
import { mediaIdSchema } from '@/server/content/validation';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ mediaId: string }>;
}

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, retryable: false } }, { status });
}

/**
 * GET /api/workspace/email/assets/:mediaId?exp=<unix>&org=<orgId>&sig=<hex>
 *
 * Signed Content Library asset delivery for rendered emails.
 *
 * This is the intentional, secure design that keeps private media private
 * while still letting a recipient's mail client load an image:
 *  - the request carries a per-asset, per-organization, expiring HMAC token
 *    instead of a session, because mail clients have no session;
 *  - the token is verified before any database read, and the media row is then
 *    re-read *with the organization filter*, so a token for one tenant can
 *    never serve another tenant's file;
 *  - storage paths are never accepted from the caller, so traversal is
 *    impossible;
 *  - responses are `private, max-age=<remaining ttl>` and never list assets.
 *
 * The route reads the media row through the service-role repository when it is
 * configured (server-side, after the token check) and otherwise through the
 * request repository; either way the organization filter is applied.
 */
export async function GET(request: Request, extra: RouteParams): Promise<NextResponse> {
  const { mediaId } = await extra.params;
  if (!mediaIdSchema.safeParse(mediaId).success) {
    return jsonError('INVALID_INPUT', 'Media id must be a valid UUID.', 400);
  }

  const url = new URL(request.url);
  const organizationId = url.searchParams.get('org') ?? '';
  const exp = url.searchParams.get('exp');
  const sig = url.searchParams.get('sig');

  if (!organizationId || !isOrganizationIdShape(organizationId)) {
    return jsonError('INVALID_INPUT', 'A signed organization parameter is required.', 400);
  }

  const token = verifyAssetToken({ mediaId, organizationId, exp, sig });
  if (!token.ok) {
    return jsonError('ASSET_TOKEN_INVALID', `The signed asset link is not valid (${token.reason}).`, 403);
  }

  // The token is the credential here, so the row is read with a repository
  // that can see it: the service-role repository when configured, otherwise the
  // request repository. The organization filter below is applied either way.
  let repo: NibrexoRepository | null = null;
  let repoError: ReturnType<typeof errorResponse> | null = null;
  const jobRepository = getJobRepository();
  if (jobRepository.ok) {
    repo = jobRepository.data;
  } else {
    const requestRepository = await getRequestRepository();
    if (requestRepository.ok) repo = requestRepository.data;
    else repoError = errorResponse(requestRepository.error);
  }
  if (!repo) return repoError ?? errorResponse({ code: 'DB_UNAVAILABLE', message: 'No data backend is available.', retryable: false, errorClass: 'server', severity: 'error' });

  const media = await repo.mediaFiles.get(mediaId, organizationId).catch(() => null);
  if (!media) {
    return jsonError('ASSET_NOT_FOUND', 'The referenced media asset is not available.', 404);
  }

  const storageResult = await getRequestMediaStorage();
  if (!storageResult.ok) return errorResponse(storageResult.error);

  const resolved = await storageResult.data.download(media.storage_path).catch(() => null);
  if (!resolved) {
    return jsonError('ASSET_NOT_FOUND', 'The referenced media asset is not available.', 404);
  }

  const expiresAt = Number.parseInt(exp ?? '0', 10);
  const remaining = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : 0;
  const safeName = filenameFromStoragePath(media.storage_path).replace(/["\r\n]/g, '');

  return new NextResponse(resolved.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': resolved.mimeType,
      'Content-Length': String(resolved.bytes.byteLength),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': `private, max-age=${remaining}`,
      ...MEDIA_RESPONSE_SECURITY_HEADERS,
    },
  });
}
