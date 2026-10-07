import { withApiContext } from '@/server/api/handler';
import { listMedia, uploadMedia } from '@/server/content/service';
import { getRequestMediaStorage } from '@/server/content/storage';
import {
  MAX_UPLOAD_BYTES,
  mediaListQuerySchema,
} from '@/server/content/validation';
import type { ManagerIssue } from '@/types/manager';

export const dynamic = 'force-dynamic';

function failure(error: ManagerIssue) {
  return {
    ok: false as const,
    status:
      error.errorClass === 'permission' ? 403 : error.errorClass === 'validation' ? 400 : 500,
    error,
  };
}

/**
 * GET /api/workspace/content/media?search=&kind=&limit=&offset=
 * Organization-scoped media rows. Bytes are served through the authorized
 * per-file route (`preview_url`), never inline here.
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = mediaListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const result = await listMedia(actor, repo, parsed.data);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
});

/**
 * POST /api/workspace/content/media — multipart upload (`file` field).
 * The server validates type/size, stores bytes under an org-prefixed path,
 * and records the `media_files` row. Storage RLS (0007) enforces the same
 * boundary at the database level.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const storageResult = await getRequestMediaStorage();
  if (!storageResult.ok) return failure(storageResult.error);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: 'Request body must be multipart form data with a file field.',
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_UPLOAD',
        message: 'A file is required.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  // Reject oversized uploads before buffering them into memory.
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_UPLOAD',
        message: 'Files must be 10 MB or smaller.',
        severity: 'warning' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const result = await uploadMedia(actor, repo, storageResult.data, {
    filename: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});
