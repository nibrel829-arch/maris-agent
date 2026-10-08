import { parseBody, withApiContext } from '@/server/api/handler';
import { createTemplate, listTemplates } from '@/server/email/service';
import { createTemplateSchema, templateListQuerySchema } from '@/server/email/validation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/email/templates?search=&category=&status=&archived=&limit=&offset=
 * Tenant-scoped template directory with search, category/status filter and pagination.
 */
export const GET = withApiContext(async ({ actor, repo }, request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = templateListQuerySchema.safeParse(params);
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

  const result = await listTemplates(actor, repo, parsed.data);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data };
});

/**
 * POST /api/workspace/email/templates
 * Creates an organization-owned template. Validation includes malformed placeholder rejection.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, createTemplateSchema);
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

  const result = await createTemplate(actor, repo, body.data);
  if (!result.ok) {
    const status =
      result.error.errorClass === 'permission' ? 403 : result.error.errorClass === 'validation' ? 400 : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data, status: 201 };
});
