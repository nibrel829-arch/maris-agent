import { withApiContext } from '@/server/api/handler';
import { deleteMedia, getMedia } from '@/server/content/service';
import { getRequestMediaStorage } from '@/server/content/storage';
import { mediaIdSchema } from '@/server/content/validation';
import type { ManagerIssue } from '@/types/manager';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function routeId(extra: unknown): Promise<string | null> {
  const { id } = await (extra as RouteParams).params;
  return mediaIdSchema.safeParse(id).success ? id : null;
}

function invalidId() {
  return {
    ok: false as const,
    status: 400,
    error: {
      code: 'INVALID_INPUT',
      message: 'Media id must be a valid UUID.',
      severity: 'error' as const,
      retryable: false,
      errorClass: 'validation' as const,
    },
  };
}

function failure(error: ManagerIssue) {
  if (error.code === 'MEDIA_NOT_FOUND') {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: 'MEDIA_NOT_FOUND',
        message: 'Media file not found.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }
  return {
    ok: false as const,
    status:
      error.errorClass === 'permission' ? 403 : error.errorClass === 'validation' ? 400 : 500,
    error,
  };
}

/** GET /api/workspace/content/media/:id — metadata (bytes via :id/file). */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const result = await getMedia(actor, repo, id);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
});

/** DELETE /api/workspace/content/media/:id — owner/admin only. */
export const DELETE = withApiContext(async ({ actor, repo }, _request, extra) => {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const storageResult = await getRequestMediaStorage();
  if (!storageResult.ok) return failure(storageResult.error);

  const result = await deleteMedia(actor, repo, storageResult.data, id);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
});
