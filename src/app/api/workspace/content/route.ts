import { parseBody, withApiContext } from '@/server/api/handler';
import { createContentItem, listContentItems } from '@/server/content/service';
import { contentListQuerySchema, createContentSchema } from '@/server/content/validation';
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
 * GET /api/workspace/content?search=&status=&platform=&limit=&offset=
 * Organization-scoped content library. Tenancy comes from the session actor.
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = contentListQuerySchema.safeParse(params);
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

  const result = await listContentItems(actor, repo, parsed.data);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data };
});

/**
 * POST /api/workspace/content
 * Creates a DRAFT in the actor's organization. The status is always DRAFT —
 * READY is a deliberate later transition, publishing belongs to Phase 8.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createContentSchema);
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

  const result = await createContentItem(actor, repo, body.data);
  if (!result.ok) return failure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});
