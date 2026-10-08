import { parseBody, withApiContext } from '@/server/api/handler';
import { deleteTemplate, getTemplate, updateTemplate } from '@/server/email/service';
import { updateTemplateSchema } from '@/server/email/validation';

export const dynamic = 'force-dynamic';

export const GET = withApiContext(async ({ actor, repo }, _request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const result = await getTemplate(actor, repo, id);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.code === 'TEMPLATE_NOT_FOUND' ? 404 : result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data };
});

export const PATCH = withApiContext(async ({ actor, repo }, request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await parseBody(request, updateTemplateSchema);
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

  const result = await updateTemplate(actor, repo, id, body.data);
  if (!result.ok) {
    const status =
      result.error.code === 'TEMPLATE_NOT_FOUND'
        ? 404
        : result.error.errorClass === 'permission'
          ? 403
          : result.error.errorClass === 'validation'
            ? 400
            : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

// Support PUT as alias for PATCH (idempotent update)
export const PUT = PATCH;

export const DELETE = withApiContext(async ({ actor, repo }, _request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const result = await deleteTemplate(actor, repo, id);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.code === 'TEMPLATE_NOT_FOUND' ? 404 : result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data };
});
