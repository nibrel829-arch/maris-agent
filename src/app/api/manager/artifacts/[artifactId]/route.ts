import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api/handler';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { authorizeArtifactDownload } from '@/server/artifacts/service';
import { mediaIdSchema } from '@/server/content/validation';
import { MEDIA_RESPONSE_SECURITY_HEADERS } from '@/server/content/media-headers';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ artifactId: string }>;
}

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, retryable: false } }, { status });
}

/** Strips characters that could break the header and sanitises the file name. */
function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'deliverable';
}

/**
 * GET /api/manager/artifacts/:artifactId — authorized deliverable download.
 *
 * Streams the stored bytes as an attachment after the role check (ai:create,
 * which the client role lacks), the organization-scoped lookup and the SHA-256
 * integrity check. The id is opaque; no storage path is accepted from the caller.
 */
export async function GET(_request: Request, extra: RouteParams): Promise<NextResponse> {
  const { artifactId } = await extra.params;
  if (!mediaIdSchema.safeParse(artifactId).success) {
    return jsonError('INVALID_INPUT', 'Deliverable id must be a valid UUID.', 400);
  }

  const actorResult = await resolveActor();
  if (!actorResult.ok) return errorResponse(actorResult.error);

  const repoResult = await getRequestRepository();
  if (!repoResult.ok) return errorResponse(repoResult.error);

  const result = await authorizeArtifactDownload({
    repo: repoResult.data,
    actor: actorResult.data,
    artifactId,
  });
  if (!result.ok) {
    return jsonError(result.error.code, result.error.message, result.error.status);
  }

  const { record, bytes } = result.data;
  const body = new Blob([Uint8Array.from(bytes)], { type: record.mime_type });
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...MEDIA_RESPONSE_SECURITY_HEADERS,
      'Content-Type': record.mime_type,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${safeFileName(record.file_name)}"`,
      'Cache-Control': 'private, no-store',
      'X-Artifact-SHA256': record.sha256,
    },
  });
}
