import { parseBody, withApiContext, type ApiContext } from '@/server/api/handler';
import {
  deleteContentItem,
  getContentItem,
  updateContentItem,
} from '@/server/content/service';
import { contentIdSchema, updateContentSchema } from '@/server/content/validation';
import type { ManagerIssue } from '@/types/manager';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function routeId(extra: unknown): Promise<string | null> {
  const { id } = await (extra as RouteParams).params;
  return contentIdSchema.safeParse(id).success ? id : null;
}

function invalidId() {
  return {
    ok: false as const,
    status: 400,
    error: {
      code: 'INVALID_INPUT',
      message: 'Content id must be a valid UUID.',
      severity: 'error' as const,
      retryable: false,
      errorClass: 'validation' as const,
    },
  };
}

function failure(error: ManagerIssue) {
  if (error.code === 'CONTENT_NOT_FOUND') {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: 'CONTENT_NOT_FOUND',
        message: 'Content item not found.',
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

/** GET /api/workspace/content/:id */
export const GET = withApiContext(async ({ actor, repo }, _request, extra) => {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const result = await getContentItem(actor, repo, id);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
});

async function update(context: ApiContext, request: Request, extra: unknown) {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const body = await parseBody(request, updateContentSchema);
  if (!body.ok) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: body.message,
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const result = await updateContentItem(context.actor, context.repo, id, body.data);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
}

/** PATCH /api/workspace/content/:id — partial update (PUT accepted too). */
export const PATCH = withApiContext(update);
export const PUT = withApiContext(update);

/** DELETE /api/workspace/content/:id — owner/admin only. No media cascade. */
export const DELETE = withApiContext(async ({ actor, repo }, _request, extra) => {
  const id = await routeId(extra);
  if (!id) return invalidId();

  const result = await deleteContentItem(actor, repo, id);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
});
