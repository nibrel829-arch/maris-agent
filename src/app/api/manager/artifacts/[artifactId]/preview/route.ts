import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api/handler';
import { resolveActor } from '@/server/auth/actor';
import { getRequestRepository } from '@/server/db';
import { authorizeArtifactDownload } from '@/server/artifacts/service';
import { previewArtifact } from '@/server/artifacts/preview';
import { mediaIdSchema } from '@/server/content/validation';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ artifactId: string }>;
}

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, retryable: false } }, { status });
}

/**
 * GET /api/manager/artifacts/:artifactId/preview — bounded text or table view.
 *
 * Uses the same authorization as the download (ai:create, organization-scoped
 * lookup, SHA-256 integrity check), so a preview never shows more than the
 * download would. The response is JSON and never includes the storage path.
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
  if (!result.ok) return jsonError(result.error.code, result.error.message, result.error.status);

  const { record, bytes } = result.data;
  const preview = previewArtifact({ format: record.format, bytes });
  return NextResponse.json(
    {
      ok: true,
      data: {
        id: record.id,
        title: record.title,
        format: record.format,
        fileName: record.file_name,
        sizeBytes: record.size_bytes,
        preview,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
